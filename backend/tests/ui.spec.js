import { test, expect } from "@playwright/test";

const baseURL = process.env.TEST_BASE_URL || "http://127.0.0.1:4100";

async function login(page) {
  await page.goto(baseURL);
  await page.getByRole("button", { name: "Войти", exact: true }).first().click();
  await page.locator("#loginEmail").fill("user@np.ru");
  await page.locator("#loginPass").fill("123456");
  await page.locator("#loginForm").getByRole("button", { name: "Войти" }).click();
  await expect(page.locator(".shell")).toBeVisible();
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 360, height: 800 },
]) {
  test(`${viewport.name} workspace and video dialog`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await login(page);
    await page.goto(`${baseURL}/#/mentor`);
    await expect(page.getByRole("button", { name: /Видеовстреча/ })).toBeVisible();
    await page.getByRole("button", { name: /Видеовстреча/ }).click();
    await expect(page.getByRole("button", { name: /Яндекс Телемост/ })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-artifacts/${viewport.name}-mentor.png`, fullPage: true });
  });
}

test("registration, recovery and admin organization editor are responsive", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseURL);
  await page.getByRole("button", { name: "Начать бесплатно", exact: true }).click();
  await expect(page.locator("#regSubject")).toHaveAttribute("list", "subjectOptions");
  await expect(page.locator("#regRegion")).toHaveAttribute("list", "regionOptions");
  await expect(page.locator("#regOrganization option")).not.toHaveCount(1);
  await expect(page.locator("#regSchool")).toHaveCount(0);
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-artifacts/mobile-registration.png", fullPage: true });

  const email = `ui-code-${Date.now()}@test.local`;
  await page.locator("#regName").fill("Проверка Кода");
  await page.locator("#regEmail").fill(email);
  await page.locator("#regPass").fill("password-123");
  await page.locator("#regSubject").fill("Математика");
  await page.locator("#regRegion").fill("Москва");
  await page.locator("#registerForm").getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page.locator("#verifyForm")).toBeVisible();
  await expect(page.locator("#verifyCode")).toHaveValue("");
  await page.locator("#authClose").click();

  await page.getByRole("button", { name: "Войти", exact: true }).first().click();
  await page.locator("#forgotPasswordLink").click();
  await expect(page.getByRole("heading", { name: "Восстановление пароля" })).toBeVisible();
  await page.locator("#authClose").click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Войти", exact: true }).first().click();
  await page.locator("#loginEmail").fill("admin@np.ru");
  await page.locator("#loginPass").fill("123456");
  await page.locator("#loginForm").getByRole("button", { name: "Войти" }).click();
  await page.goto(`${baseURL}/#/organizations`);
  await expect(page.getByRole("heading", { name: "Организации и дизайн" })).toBeVisible();
  await expect(page.getByText("Визуальное оформление")).toBeVisible();
  overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-artifacts/desktop-organizations.png", fullPage: true });
});

test("roadmap stages, event filters, portfolio photo and personal reports work", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.goto(`${baseURL}/#/roadmap`);
  await expect(page.getByRole("heading", { name: "Дорожная карта" })).toBeVisible();
  await page.waitForFunction(() => document.querySelector(".editable-stages .route-node") || Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.includes("Построить карту")));
  if (await page.locator(".editable-stages .route-node").count() === 0) {
    await expect(page.getByRole("button", { name: "Построить карту" })).toBeVisible();
    await page.getByRole("button", { name: "Построить карту" }).click();
  }
  await expect(page.locator(".editable-stages .route-node")).toHaveCount(6);
  const currentIndex = await page.locator('.editable-stages .route-node[aria-current="step"]').evaluate((node) => Array.from(node.parentElement.children).indexOf(node));
  const targetIndex = currentIndex === 3 ? 4 : 3;
  await page.locator(".editable-stages .route-node").nth(targetIndex).click();
  await expect(page.locator(".editable-stages .route-node").nth(targetIndex)).toHaveAttribute("aria-current", "step");
  await page.screenshot({ path: "test-artifacts/desktop-roadmap-refresh.png", fullPage: true });

  await page.goto(`${baseURL}/#/events`);
  await expect(page.locator(".event-filter-bar select")).toHaveCount(3);
  await page.locator('.event-search input[type="search"]').fill("метод");
  await page.waitForTimeout(450);
  await expect(page.locator(".event-results-meta")).toBeVisible();
  await page.screenshot({ path: "test-artifacts/desktop-events-refresh.png", fullPage: true });

  await page.goto(`${baseURL}/#/portfolio`);
  await expect(page.locator(".portfolio-cover .portfolio-avatar")).toBeVisible();
  await page.screenshot({ path: "test-artifacts/desktop-portfolio-refresh.png", fullPage: true });
  await page.goto(`${baseURL}/#/reports`);
  await expect(page.locator(".report-note")).toBeVisible();
  await expect(page.locator(".data-table")).toHaveCount(0);
  await page.screenshot({ path: "test-artifacts/desktop-reports-refresh.png", fullPage: true });
  await page.goto(`${baseURL}/#/profile`);
  await expect(page.getByText("Статус ИИ-наставника")).toHaveCount(0);

  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${baseURL}/#/events`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-artifacts/mobile-events-refresh.png", fullPage: true });
});

test("leaderboard is available on desktop and mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.goto(`${baseURL}/#/leaderboard`);
  await expect(page.getByRole("heading", { name: "Рейтинг педагогов" })).toBeVisible();
  await expect(page.locator(".leader-row")).not.toHaveCount(0);
  await page.screenshot({ path: "test-artifacts/desktop-leaderboard.png", fullPage: true });
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-artifacts/mobile-leaderboard.png", fullPage: true });
});
