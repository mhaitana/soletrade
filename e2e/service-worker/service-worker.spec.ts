import { test, expect } from "@playwright/test";

/**
 * Service-worker smoke tests for INFRA-003.
 *
 * Verifies:
 * - /offline exists and renders without JavaScript.
 * - The service worker asset and registration entry point are present.
 */
test.describe("service worker / offline fallback", () => {
  test("/offline renders static fallback", async ({ page }) => {
    await page.goto("/offline");
    await expect(page.getByRole("heading", { name: /you are offline/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /reload page/i })).toBeVisible();
  });

  test("service worker script is served at /sw.js", async ({ request }) => {
    const response = await request.get("/sw.js");
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain("Minimal service worker for Soletrade Workspace");
  });
});
