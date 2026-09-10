import { test, expect } from "@playwright/test";

const baseURL = process.env.TEST_BASE_URL || "http://127.0.0.1:4100";

async function api(request, path, { method = "GET", token, data } = {}) {
  const response = await request.fetch(`${baseURL}/api${path}`, {
    method, headers: token ? { Authorization: `Bearer ${token}` } : {}, data,
  });
  let body = {};
  try { body = await response.json(); } catch {}
  return { response, body };
}

test("email verification and password reset codes are single-use", async ({ request }) => {
  const email = `security-${Date.now()}@test.local`;
  const registration = await api(request, "/auth/register", { method: "POST", data: {
    fullName: "Тест Безопасности", email, password: "initial-pass", subject: "Информатика", region: "Москва", role: "user",
  } });
  expect(registration.response.status()).toBe(201);
  const blocked = await api(request, "/auth/login", { method: "POST", data: { email, password: "initial-pass" } });
  expect(blocked.response.status()).toBe(403);
  const wrong = await api(request, "/auth/verify-email", { method: "POST", data: { email, code: "999999" } });
  expect(wrong.response.status()).toBe(400);
  const verified = await api(request, "/auth/verify-email", { method: "POST", data: { email, code: registration.body.debugCode } });
  expect(verified.response.ok()).toBe(true);
  const reusedVerification = await api(request, "/auth/verify-email", { method: "POST", data: { email, code: registration.body.debugCode } });
  expect(reusedVerification.response.status()).toBe(400);

  const unknown = await api(request, "/auth/forgot-password", { method: "POST", data: { email: "missing@test.local" } });
  expect(unknown.body.message).toBe("Если аккаунт существует, код отправлен на почту");
  const reset = await api(request, "/auth/forgot-password", { method: "POST", data: { email } });
  const changed = await api(request, "/auth/reset-password", { method: "POST", data: { email, code: reset.body.debugCode, password: "changed-pass" } });
  expect(changed.response.ok()).toBe(true);
  const reusedReset = await api(request, "/auth/reset-password", { method: "POST", data: { email, code: reset.body.debugCode, password: "another-pass" } });
  expect(reusedReset.response.status()).toBe(400);
  expect((await api(request, "/auth/login", { method: "POST", data: { email, password: "initial-pass" } })).response.status()).toBe(401);
  expect((await api(request, "/auth/login", { method: "POST", data: { email, password: "changed-pass" } })).response.ok()).toBe(true);
});

test("avatar validation and organization administration enforce permissions", async ({ request }) => {
  const admin = await api(request, "/auth/login", { method: "POST", data: { email: "admin@np.ru", password: "123456" } });
  const user = await api(request, "/auth/login", { method: "POST", data: { email: "user@np.ru", password: "123456" } });
  const organization = await api(request, "/organizations", { method: "POST", token: admin.body.token, data: {
    name: `Тестовая организация ${Date.now()}`, shortName: "Тест", region: "Москва", domain: "test.local",
  } });
  expect(organization.response.status()).toBe(201);
  const id = organization.body.organization.id;
  const forbidden = await api(request, `/organizations/${id}/theme`, { method: "PUT", token: user.body.token, data: { productName: "Подмена" } });
  expect(forbidden.response.status()).toBe(403);
  const theme = await api(request, `/organizations/${id}/theme`, { method: "PUT", token: admin.body.token, data: {
    productName: "Школьный навигатор", primaryColor: "#006d77", accentColor: "#c43d63", surfaceColor: "#ffffff", fontScale: 1.05, compactMode: true,
  } });
  expect(theme.body.theme.productName).toBe("Школьный навигатор");

  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const uploaded = await api(request, "/users/me/avatar", { method: "PUT", token: user.body.token, data: { mime: "image/png", dataBase64: png } });
  expect(uploaded.body.user.hasAvatar).toBe(true);
  const invalid = await api(request, "/users/me/avatar", { method: "PUT", token: user.body.token, data: { mime: "image/jpeg", dataBase64: png } });
  expect(invalid.response.status()).toBe(400);
  const image = await request.get(`${baseURL}/api/users/${user.body.user.id}/avatar`);
  expect(image.headers()["content-type"]).toContain("image/png");
  const portfolioPdf = await request.get(`${baseURL}/api/ai/portfolio/pdf`, { headers: { Authorization: `Bearer ${user.body.token}` } });
  expect(portfolioPdf.ok()).toBe(true);
  expect(portfolioPdf.headers()["content-type"]).toContain("application/pdf");
  expect((await portfolioPdf.body()).length).toBeGreaterThan(1000);
  const removed = await api(request, "/users/me/avatar", { method: "DELETE", token: user.body.token });
  expect(removed.body.user.hasAvatar).toBe(false);
});

test("teacher can persist a valid algorithm stage", async ({ request }) => {
  const user = await api(request, "/auth/login", { method: "POST", data: { email: "user@np.ru", password: "123456" } });
  const originalStage = user.body.user.currentStage;
  const updated = await api(request, "/users/me", { method: "PUT", token: user.body.token, data: { currentStage: 4 } });
  expect(updated.response.ok()).toBe(true);
  expect(updated.body.user.currentStage).toBe(4);
  const invalid = await api(request, "/users/me", { method: "PUT", token: user.body.token, data: { currentStage: 7 } });
  expect(invalid.response.status()).toBe(400);
  await api(request, "/users/me", { method: "PUT", token: user.body.token, data: { currentStage: originalStage } });
});

test("administrator manages all learning process modules", async ({ request }) => {
  const admin = await api(request, "/auth/login", { method: "POST", data: { email: "admin@np.ru", password: "123456" } });
  const user = await api(request, "/auth/login", { method: "POST", data: { email: "user@np.ru", password: "123456" } });
  const group = await api(request, "/groups", { method: "POST", token: admin.body.token, data: { name: "Контрольная группа", description: "Проверка полномочий" } });
  expect(group.response.ok()).toBe(true);
  await api(request, `/groups/${group.body.group.id}/members`, { method: "POST", token: admin.body.token, data: { userId: user.body.user.id } });
  expect((await api(request, "/groups", { token: admin.body.token })).body.groups.some((item) => item.id === group.body.group.id)).toBe(true);

  const customTest = await api(request, "/tests", { method: "POST", token: admin.body.token, data: {
    title: "Проверка процесса", description: "Административный тест",
    questions: [{ q: "Выберите ответ", options: ["Верно", "Неверно"], correctIndex: 0, points: 1 }],
  } });
  expect(customTest.response.ok()).toBe(true);
  const assignment = await api(request, "/assignments", { method: "POST", token: admin.body.token, data: {
    title: "Административное задание", testId: customTest.body.test.id, userIds: [user.body.user.id],
  } });
  expect(assignment.response.ok()).toBe(true);
  expect((await api(request, "/assignments", { token: admin.body.token })).body.assignments.some((item) => item.id === assignment.body.assignment.id)).toBe(true);
  expect((await api(request, `/assignments/${assignment.body.assignment.id}`, { token: admin.body.token })).response.ok()).toBe(true);
  await api(request, `/assignments/${assignment.body.assignment.id}`, { method: "DELETE", token: admin.body.token });
  await api(request, `/tests/${customTest.body.test.id}`, { method: "DELETE", token: admin.body.token });
  await api(request, `/groups/${group.body.group.id}`, { method: "DELETE", token: admin.body.token });
});

test("mail test endpoint is restricted to administrators", async ({ request }) => {
  const user = await api(request, "/auth/login", { method: "POST", data: { email: "user@np.ru", password: "123456" } });
  const forbidden = await api(request, "/auth/mail-test", { method: "POST", token: user.body.token, data: { email: "recipient@test.local" } });
  expect(forbidden.response.status()).toBe(403);
});
