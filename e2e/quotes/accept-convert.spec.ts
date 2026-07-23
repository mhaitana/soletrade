import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { switchWorkspace, test } from "../fixtures/auth";

/**
 * Accept-quote-and-convert smoke flow (F006).
 *
 * Creates and sends a fresh quote via the owner fixture, opens the public token in
 * a second unauthenticated context, accepts it with a signature, then returns to the
 * owner context to assert the quote is converted to a draft invoice.
 */

const ACTIVE_WORKSPACE = "Soletrade Demo Co";

async function createCustomer(ownerPage: Page, name: string, email: string): Promise<void> {
  await ownerPage.getByRole("button", { name: "Add customer" }).click();
  const addDialog = ownerPage.getByRole("dialog").filter({ hasText: "Add customer" });
  await expect(addDialog).toBeVisible();
  await addDialog.getByLabel("Name").fill(name);
  await addDialog.getByLabel("Email").fill(email);
  await addDialog.getByRole("button", { name: "Add customer" }).click();
  await expect(addDialog).not.toBeVisible();
}

async function createAndSendQuote(ownerPage: Page, projectName: string): Promise<string> {
  // Force a desktop viewport for the authenticated owner flow so workspace
  // switching and quote creation use the desktop chrome regardless of the
  // Playwright project viewport.
  await ownerPage.setViewportSize({ width: 1280, height: 720 });

  await ownerPage.goto("/quotes/new", { waitUntil: "networkidle" });
  await switchWorkspace(ownerPage, ACTIVE_WORKSPACE);

  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const customerName = `F006 ${projectName} ${suffix}`;
  const customerEmail = `f006-${suffix}@example.com`;

  await createCustomer(ownerPage, customerName, customerEmail);

  await ownerPage.getByLabel("Line 1 description").fill("Accept-and-convert smoke test");
  await ownerPage.getByLabel("Line 1 unit price").fill("200.00");

  await ownerPage.getByRole("button", { name: "Create quote" }).click();
  await ownerPage.waitForURL("/quotes");

  // Find the quote by its unique customer name instead of relying on row order.
  const search = ownerPage.getByRole("search").getByLabel("Search quotes");
  await search.fill(customerName);
  await search.press("Enter");
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

  // Send the quote to generate the public token.
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

test.describe("accept quote and convert", () => {
  test("public quote can be accepted and converts to a draft invoice", async ({
    ownerPage,
    browser,
    viewport,
  }) => {
    test.skip(viewport === null || viewport.width < 1280, "Desktop-only flow");

    const token = await createAndSendQuote(ownerPage, test.info().project.name);

    // Accept the quote in a fresh, unauthenticated browser context.
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const publicPage = await context.newPage();
    await publicPage.goto(`/q/${token}`, { waitUntil: "networkidle" });

    await publicPage.getByRole("button", { name: "Accept quote" }).click();

    const canvas = publicPage.locator('[data-testid="signature-canvas"]');
    await expect(canvas).toBeVisible();
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();

    await publicPage.getByLabel("Your name").fill("Smoke Buyer");
    await drawSignature(publicPage, canvasBox!);

    await publicPage.getByRole("button", { name: "Confirm accept" }).click();
    await expect(
      publicPage.getByRole("status").filter({ hasText: "Quote accepted" }).first(),
    ).toBeVisible({ timeout: 10_000 });
    await context.close();

    // Owner context: refresh the quote detail, convert the accepted quote to a
    // draft invoice, and verify the resulting invoice page.
    await ownerPage.reload({ waitUntil: "networkidle" });
    await expect(ownerPage.getByText("Accepted").first()).toBeVisible();
    await expect(ownerPage.getByRole("button", { name: "Convert to invoice" })).toBeVisible();

    await ownerPage.getByRole("button", { name: "Convert to invoice" }).click();
    await expect(ownerPage.getByRole("dialog")).toBeVisible();
    await ownerPage.getByRole("dialog").getByRole("button", { name: "Convert to invoice" }).click();
    await ownerPage.waitForURL(/\/invoices\/[^/]+$/);

    await expect(ownerPage.getByRole("heading", { name: /^INV-/ })).toBeVisible();
    await expect(ownerPage.getByText("Draft").first()).toBeVisible();
  });
});
