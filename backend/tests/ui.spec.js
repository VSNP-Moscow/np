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
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-artifacts/mobile-registration.png", fullPage: true });

  await page.locator("#tabLogin").click();
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
