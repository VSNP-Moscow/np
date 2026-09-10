import { test, expect } from "@playwright/test";

const baseURL = process.env.TEST_BASE_URL || "http://127.0.0.1:4100";

async function api(request, path, { method = "GET", token, data } = {}) {
  const response = await request.fetch(`${baseURL}/api${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    data,
  });
  return { response, body: await response.json() };
}

async function registerAndVerify(request, data) {
  const registered = await api(request, "/auth/register", { method: "POST", data });
  expect(registered.response.status()).toBe(201);
  expect(registered.body.debugCode).toMatch(/^\d{6}$/);
  const verified = await api(request, "/auth/verify-email", {
    method: "POST", data: { email: data.email, code: registered.body.debugCode },
  });
  expect(verified.response.ok()).toBe(true);
  return verified.body;
}

test("new teacher starts with an open diagnostic and no answer choices", async ({ page }) => {
  const email = `onboarding-${Date.now()}@test.local`;
  await registerAndVerify(page.request, {
    fullName: "Новый Педагог", email, password: "12345678", subject: "Русский язык",
    school: "Тестовая школа", region: "Москва", role: "user",
  });

  await page.goto(baseURL);
  await page.getByRole("button", { name: "Войти", exact: true }).first().click();
  await page.locator("#loginEmail").fill(email);
  await page.locator("#loginPass").fill("12345678");
  await page.locator("#loginForm").getByRole("button", { name: "Войти" }).click();

  await expect(page).toHaveURL(/#\/assistant$/);
  await expect(page.getByRole("heading", { name: "Стартовая диагностика" })).toBeVisible();
  await expect(page.locator(".reply-chip")).toHaveCount(0);
  await expect(page.locator('.nav-link[data-view="assistant"]')).toBeVisible();
  await expect(page.locator('.nav-link[data-view="roadmap"]')).toHaveCount(0);
});

test("mentor edits and approves without allowing AI to replace the published version", async ({ request }) => {
  const email = `workflow-${Date.now()}@test.local`;
  const registered = await registerAndVerify(request, {
    fullName: "Педагог Для Согласования", email, password: "12345678", subject: "Математика",
    school: "Тестовая школа", region: "Москва", role: "user",
  });
  const teacher = registered.user;
  const teacherToken = registered.token;

  await api(request, "/ai/diagnostic/start", { method: "POST", token: teacherToken });
  let result;
  for (let index = 0; index < 18; index += 1) {
    result = await api(request, "/ai/diagnostic/reply", {
      method: "POST", token: teacherToken,
      data: { text: "Справляюсь уверенно, применяю приём на уроке и анализирую результат." },
    });
  }
  expect(result.body.diagnosticActive).toBe(false);
  expect(result.body.roadmap.status).toBe("mentor_review");

  const admin = await api(request, "/auth/login", { method: "POST", data: { email: "admin@np.ru", password: "123456" } });
  const mentor = await api(request, "/auth/login", { method: "POST", data: { email: "mentor@np.ru", password: "123456" } });
  await api(request, `/users/${teacher.id}/mentor`, { method: "PUT", token: admin.body.token, data: { mentorId: mentor.body.user.id } });

  const workflow = await api(request, `/ai/roadmap/mentee/${teacher.id}`, { token: mentor.body.token });
  const draft = workflow.body.workflow.draft;
  const edited = await api(request, `/ai/roadmap/mentee/${teacher.id}`, {
    method: "PUT", token: mentor.body.token,
    data: { summary: "Проверенный совместный план", priorities: draft.priorities, mentorComment: "Фокус на практике" },
  });
  expect(edited.body.roadmap.source).toBe("mentor");

  const forbidden = await api(request, `/ai/roadmap/mentee/${teacher.id}/approve`, { method: "POST", token: teacherToken, data: {} });
  expect(forbidden.response.status()).toBe(403);
  const approved = await api(request, `/ai/roadmap/mentee/${teacher.id}/approve`, {
    method: "POST", token: mentor.body.token, data: { mentorComment: "План согласован" },
  });
  expect(approved.body.roadmap.status).toBe("approved");
  expect(approved.body.roadmap.version).toBe(1);

  await api(request, "/ai/roadmap/generate", { method: "POST", token: teacherToken, data: { region: "Москва" } });
  const visible = await api(request, "/ai/roadmap", { token: teacherToken });
  expect(visible.body.roadmap.status).toBe("approved");
  expect(visible.body.roadmap.version).toBe(1);
  expect(visible.body.roadmap.proposalStatus).toBe("mentor_review");

  const search = await api(request, "/events?q=цифровые", { token: teacherToken });
  expect(search.body.events.some((event) => /цифровые/i.test(event.title))).toBe(true);
});
