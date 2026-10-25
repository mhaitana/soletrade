import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { switchWorkspace, test } from "../fixtures/auth";

/**
 * Responsive signature canvas audit (F005).
 *
 * Each test creates and sends a fresh quote via the owner fixture, then opens the
 * public `/q/[token]` page in a new unauthenticated context. This avoids collisions
 * on the seeded shared quote and lets us resize the viewport during signature capture.
 */

const ACTIVE_WORKSPACE = "Soletrade Demo Co";

async function createAndSendQuote(ownerPage: Page, projectName: string): Promise<string> {
  // Force a desktop viewport for the authenticated owner flow so workspace
  // switching and quote creation use the desktop chrome regardless of the
  // Playwright project viewport.
  await ownerPage.setViewportSize({ width: 1280, height: 720 });

  await ownerPage.goto("/quotes/new", { waitUntil: "networkidle" });
  await switchWorkspace(ownerPage, ACTIVE_WORKSPACE);

  // Create a unique customer per test/project so concurrent runs don't race on the
  // "most recent quote" row in the shared workspace.
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const customerName = `F005 ${projectName} ${suffix}`;
  const customerEmail = `f005-${suffix}@example.com`;

  await ownerPage.getByRole("button", { name: "Add customer" }).click();
  const addDialog = ownerPage.getByRole("dialog").filter({ hasText: "Add customer" });
  await expect(addDialog).toBeVisible();
  await addDialog.getByLabel("Name").fill(customerName);
  await addDialog.getByLabel("Email").fill(customerEmail);
  await addDialog.getByRole("button", { name: "Add customer" }).click();
  await expect(addDialog).not.toBeVisible();

  await ownerPage.getByLabel("Line 1 description").fill("Responsive signature test");
  await ownerPage.getByLabel("Line 1 unit price").fill("100.00");

  await ownerPage.getByRole("button", { name: "Create quote" }).click();
  await ownerPage.waitForURL("/quotes", { waitUntil: "networkidle" });

  // Find the quote by its unique customer name instead of relying on row order.
  const search = ownerPage.getByRole("search").getByLabel("Search quotes");
  await search.fill(customerName);
  // The new row is also present before search; wait for the GET navigation
  // before clicking it so the assertion cannot match the previous document.
  await Promise.all([
    ownerPage.waitForURL(
      (url) => url.pathname === "/quotes" && url.searchParams.get("search") === customerName,
      { waitUntil: "networkidle" },
    ),
    search.press("Enter"),
  ]);
  await expect(
    ownerPage.locator("table tbody tr").filter({ hasText: customerName }).first(),
  ).toBeVisible();

  await ownerPage
    .locator("table tbody tr")
    .filter({ hasText: customerName })
    .locator("td:first-child a")
    .first()
    .click();
  await ownerPage.waitForURL(/\/quotes\/[^/]+$/);

  await ownerPage.getByRole("button", { name: "Send" }).click();
  await expect(ownerPage.getByRole("dialog")).toBeVisible();
  await ownerPage.getByRole("dialog").getByRole("button", { name: "Send" }).click();
  await expect(ownerPage.getByTestId("quote-public-link")).toBeVisible({ timeout: 10_000 });

  const linkText = await ownerPage.getByTestId("quote-public-link").textContent();
  const token = linkText?.trim().replace("/q/", "");
  if (!token) throw new Error("Failed to extract public token from quote detail page.");
  return token;
}

function drawSignature(
  page: Page,
  canvasBox: { x: number; y: number; width: number; height: number },
): Promise<void> {
  // A simple zig-zag stroke in the middle of the canvas.
  const startX = canvasBox.x + canvasBox.width * 0.15;
  const startY = canvasBox.y + canvasBox.height * 0.55;
  return page.mouse.move(startX, startY).then(() =>
    page.mouse
      .down()
      .then(() =>
        page.mouse
          .move(canvasBox.x + canvasBox.width * 0.35, canvasBox.y + canvasBox.height * 0.45, {
            steps: 5,
          })
          .then(() =>
            page.mouse.move(
              canvasBox.x + canvasBox.width * 0.6,
              canvasBox.y + canvasBox.height * 0.6,
              { steps: 5 },
            ),
          )
          .then(() =>
            page.mouse.move(
              canvasBox.x + canvasBox.width * 0.85,
              canvasBox.y + canvasBox.height * 0.4,
              { steps: 5 },
            ),
          ),
      )
      .then(() => page.mouse.up()),
  );
}

test.describe.configure({ mode: "serial" });

test("signature canvas fills container and accepting quote succeeds on mobile", async ({
  ownerPage,
  browser,
}) => {
  const token = await createAndSendQuote(ownerPage, test.info().project.name);

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  await page.goto(`/q/${token}`, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Accept quote" }).click();

  const canvas = page.locator('[data-testid="signature-canvas"]');
  await expect(canvas).toBeVisible();

  // Canvas should fill the width of its container (allow sub-pixel layout tolerance).
  let canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  const containerWidth = await canvas.evaluate(
    (el) => el.parentElement?.getBoundingClientRect().width ?? 0,
  );
  expect(Math.abs(canvasBox!.width - containerWidth)).toBeLessThanOrEqual(6);

  await page.getByLabel("Your name").fill("Jane Buyer");

  await canvas.scrollIntoViewIfNeeded();
  // Re-measure after scrolling the mobile sheet so drawing coordinates are
  // inside the canvas, not on the sheet overlay or background buttons.
  canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await drawSignature(page, canvasBox!);

  const confirmButton = page.getByRole("button", { name: "Confirm accept" });
  await confirmButton.scrollIntoViewIfNeeded();
  await confirmButton.click();

  await expect(page.getByRole("status").filter({ hasText: "Quote accepted" }).first()).toBeVisible({
    timeout: 10_000,
  });

  await context.close();
});

test("signature canvas fills container and accepting quote succeeds on desktop", async ({
  ownerPage,
  browser,
}) => {
  const token = await createAndSendQuote(ownerPage, test.info().project.name);

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  await page.goto(`/q/${token}`, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Accept quote" }).click();

  const canvas = page.locator('[data-testid="signature-canvas"]');
  await expect(canvas).toBeVisible();

  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  const containerWidth = await canvas.evaluate(
    (el) => el.parentElement?.getBoundingClientRect().width ?? 0,
  );
  expect(Math.abs(canvasBox!.width - containerWidth)).toBeLessThanOrEqual(6);

  await page.getByLabel("Your name").fill("Desktop Buyer");
  await drawSignature(page, canvasBox!);

  // Resize to a narrower desktop viewport and confirm the canvas reflows to
  // the new container width while preserving the drawn signature.
  await page.setViewportSize({ width: 900, height: 600 });
  await expect(canvas).toBeVisible();
  const resizedBox = await canvas.boundingBox();
  const resizedContainerWidth = await canvas.evaluate(
    (el) => el.parentElement?.getBoundingClientRect().width ?? 0,
  );
  expect(Math.abs(resizedBox!.width - resizedContainerWidth)).toBeLessThanOrEqual(6);

  await page.getByRole("button", { name: "Confirm accept" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Quote accepted" }).first()).toBeVisible({
    timeout: 10_000,
  });

  await context.close();
});
