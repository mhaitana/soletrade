import { test, expect } from "@playwright/test";

/**
 * Smoke health check for the E2E harness itself.
 *
 * Verifies that the local dev server is reachable and the seeded login page
 * renders with the expected form controls on every configured viewport.
 */
test.describe("health", () => {
  test("login page renders with seeded credentials form", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: /sign in to your workspace/i })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });
});
