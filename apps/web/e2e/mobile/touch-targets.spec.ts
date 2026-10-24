import { expect, type Locator } from "@playwright/test";
import { test } from "../fixtures/auth";

/**
 * Mobile touch-target audit (F002).
 *
 * Runs on narrow viewports (iPhone 12/13 = 390px CSS width) and asserts that
 * the top interactive controls meet the minimum hit-area heights defined in
 * EPCC_PLAN.md Phase 2:
 *   - primary controls: >= 44 px
 *   - assistant suggested prompts / toggles / send-stop: >= 40 px
 *
 * Each assertion captures the element's bounding box so the failure message
 * includes the actual computed height.
 */

test.describe.configure({ mode: "parallel" });

async function expectMinHeight(locator: Locator, min: number, name: string): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${name} should have a bounding box`).not.toBeNull();
  expect(
    box!.height,
    `${name} height should be >= ${min}px (actual: ${box!.height.toFixed(1)}px)`,
  ).toBeGreaterThanOrEqual(min);
}

test("top app-shell controls are at least 44px tall", async ({ ownerPage: page }) => {
  await page.goto("/dashboard", { waitUntil: "networkidle" });

  await expectMinHeight(page.getByRole("button", { name: /open menu/i }), 44, "Open menu");
  await expectMinHeight(page.getByRole("button", { name: /search/i }), 44, "Search");
  await expectMinHeight(page.getByRole("button", { name: /notifications/i }), 44, "Notifications");
  await expectMinHeight(
    page.getByRole("button", { name: /toggle dark mode/i }),
    44,
    "Theme toggle",
  );
  await expectMinHeight(page.getByRole("button", { name: /account/i }), 44, "Account menu");
});

test("dashboard period menu is at least 44px tall", async ({ ownerPage: page }) => {
  await page.goto("/dashboard", { waitUntil: "networkidle" });

  const periodMenu = page.getByRole("button", { name: /dashboard period/i });
  await expectMinHeight(periodMenu, 44, "Dashboard period menu");
});

test("list filters collapse to compact touch-friendly menus", async ({ ownerPage: page }) => {
  await page.goto("/books", { waitUntil: "networkidle" });

  await expectMinHeight(
    page.getByRole("button", { name: /filter transactions by period/i }),
    44,
    "Books period filter",
  );
  await expectMinHeight(
    page.getByRole("button", { name: /filter transactions by type/i }),
    44,
    "Books type filter",
  );

  await page.goto("/drive", { waitUntil: "networkidle" });
  await expectMinHeight(
    page.getByRole("button", { name: /export drive data as csv/i }),
    44,
    "Drive export menu",
  );
  await expectMinHeight(
    page.getByRole("button", { name: /filter by platform/i }),
    44,
    "Drive platform filter",
  );
});

test("customer list controls are at least 44px tall", async ({ ownerPage: page }) => {
  await page.goto("/customers", { waitUntil: "networkidle" });

  const firstName = page.locator('ul li a[class*="truncate"]').first();
  await expectMinHeight(firstName, 44, "Customer name link");

  const firstEdit = page.getByLabel(/^Edit /).first();
  await expectMinHeight(firstEdit, 44, "Customer edit button");

  const firstDelete = page.getByLabel(/^Delete /).first();
  await expectMinHeight(firstDelete, 44, "Customer delete button");
});

test("settings tabs and selects are at least 44px tall", async ({ ownerPage: page }) => {
  await page.goto("/settings", { waitUntil: "networkidle" });

  const firstTab = page.getByRole("navigation", { name: "Settings" }).getByRole("link").first();
  await expectMinHeight(firstTab, 44, "Settings tab");

  const firstSelect = page.locator("select").first();
  await expectMinHeight(firstSelect, 44, "Settings select");
});

test("assistant controls are at least 40px tall", async ({ ownerPage: page }) => {
  await page.goto("/assistant", { waitUntil: "networkidle" });

  // Ensure the empty-state prompt chips are shown.
  await page.getByRole("link", { name: /new$/i }).click();
  await page.waitForURL("/assistant");

  // Suggested prompt chips end with a question mark.
  const firstPrompt = page.locator("button").filter({ hasText: /\?$/ }).first();
  await expectMinHeight(firstPrompt, 40, "Assistant suggested prompt");

  // Write-tools toggle (role=switch because it toggles a boolean state).
  await expectMinHeight(
    page.getByRole("switch", { name: /Write tools/ }),
    40,
    "Write tools toggle",
  );

  // Send icon button in the message form.
  await expectMinHeight(page.getByRole("button", { name: /send/i }), 40, "Send button");
});
