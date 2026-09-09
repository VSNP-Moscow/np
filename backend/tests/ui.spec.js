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
