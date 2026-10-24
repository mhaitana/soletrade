import { expect, type Page } from "@playwright/test";
import { switchWorkspace, test } from "../fixtures/auth";

/**
 * Mobile dense-table audit (F004).
 *
 * Verifies that the invoice/quote line-item tables and the books tax lodged-
 * quarters table collapse into stacked cards on narrow viewports, remain
 * within the screen width, and still render the desktop table on larger screens.
 */

const ACTIVE_WORKSPACE = "Soletrade Demo Co";

test.describe.configure({ mode: "parallel" });

async function closeMobileNav(page: Page): Promise<void> {
  // The mobile navigation sheet stays open after switching workspaces; close it
  // so the underlying page is reachable.
  const closeButton = page.getByRole("button", { name: /^Close$/ }).first();
  try {
    await closeButton.click({ force: true });
  } catch {
    // Sheet may not be present on larger mobile viewports; ignore.
  }
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow, "page has horizontal overflow").toBe(false);
}

test("invoice detail line items collapse to cards without horizontal scroll at 390px", async ({
  ownerPage: page,
  viewport,
}) => {
  test.skip(viewport === null || viewport.width >= 768, "Only narrow mobile viewports");

  await page.goto("/invoices", { waitUntil: "networkidle" });
  await switchWorkspace(page, ACTIVE_WORKSPACE);
  await closeMobileNav(page);

  await page.getByRole("link", { name: /^INV-/ }).first().click();
  await page.waitForURL(/\/invoices\//);

  const mobileCards = page.locator('[data-testid="invoice-line-items-mobile"]');
  await expect(mobileCards).toBeVisible();
  await expect(mobileCards.locator("> div").first()).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("quote detail line items collapse to cards without horizontal scroll at 390px", async ({
  ownerPage: page,
  viewport,
}) => {
  test.skip(viewport === null || viewport.width >= 768, "Only narrow mobile viewports");

  await page.goto("/quotes", { waitUntil: "networkidle" });
  await switchWorkspace(page, ACTIVE_WORKSPACE);
  await closeMobileNav(page);

  await page.getByRole("link", { name: /^QUO-/ }).first().click();
  await page.waitForURL(/\/quotes\//);

  const mobileCards = page.locator('[data-testid="quote-line-items-mobile"]');
  await expect(mobileCards).toBeVisible();
  await expect(mobileCards.locator("> div").first()).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("tax lodged quarters collapse to cards without horizontal scroll at 390px", async ({
  ownerPage: page,
  viewport,
}) => {
  test.skip(viewport === null || viewport.width >= 768, "Only narrow mobile viewports");

  await page.goto("/books/tax", { waitUntil: "networkidle" });
  await switchWorkspace(page, ACTIVE_WORKSPACE);
  await closeMobileNav(page);

  const mobileCards = page.locator('[data-testid="tax-lodged-mobile"]');
  await expect(mobileCards).toBeVisible();
  await expect(mobileCards.locator("> div").first()).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("invoice detail keeps the desktop line-items table at 1280px", async ({
  ownerPage: page,
  viewport,
}) => {
  test.skip(viewport === null || viewport.width < 768, "Only desktop viewports");

  await page.goto("/invoices", { waitUntil: "networkidle" });
  await switchWorkspace(page, ACTIVE_WORKSPACE);

  await page.getByRole("link", { name: /^INV-/ }).first().click();
  await page.waitForURL(/\/invoices\//);

  const table = page.locator("table").filter({ hasText: "Description" }).first();
  await expect(table).toBeVisible();
  await expect(page.locator('[data-testid="invoice-line-items-mobile"]')).not.toBeVisible();
});

test("tax lodged quarters keep the desktop table at 1280px", async ({
  ownerPage: page,
  viewport,
}) => {
  test.skip(viewport === null || viewport.width < 768, "Only desktop viewports");

  await page.goto("/books/tax", { waitUntil: "networkidle" });
  await switchWorkspace(page, ACTIVE_WORKSPACE);

  const table = page.locator("table").filter({ hasText: "Period" }).first();
  await expect(table).toBeVisible();
  await expect(page.locator('[data-testid="tax-lodged-mobile"]')).not.toBeVisible();
});
