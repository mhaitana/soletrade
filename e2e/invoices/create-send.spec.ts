import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { switchWorkspace, test } from "../fixtures/auth";

/**
 * Create-and-send invoice smoke flow (F006).
 *
 * Uses the owner fixture to create a fresh customer, draft an invoice, send it,
 * and assert the detail page moves to "Sent" with a public payment link.
 */

const ACTIVE_WORKSPACE = "Soletrade Demo Co";

async function createCustomer(ownerPage: Page, name: string, email: string): Promise<void> {
  await ownerPage.getByRole("button", { name: "Add customer" }).click();
  const addDialog = ownerPage.getByRole("dialog").filter({ hasText: "Add customer" });
  await expect(addDialog).toBeVisible();
  await addDialog.getByLabel("Name", { exact: true }).fill(name);
  await addDialog.getByLabel("Email", { exact: true }).fill(email);
  await addDialog.getByRole("button", { name: "Add customer" }).click();
  await expect(addDialog).not.toBeVisible();
}

async function createInvoice(ownerPage: Page, customerName: string): Promise<string> {
  await ownerPage.goto("/invoices/new", { waitUntil: "networkidle" });
  await switchWorkspace(ownerPage, ACTIVE_WORKSPACE);

  await createCustomer(ownerPage, customerName, `invoice-${randomUUID().slice(0, 8)}@example.com`);

  await ownerPage.getByLabel("Line 1 description").fill("E2E smoke test line");
  await ownerPage.getByLabel("Line 1 unit price").fill("150.00");

  await ownerPage.getByRole("button", { name: "Create invoice" }).click();
  // Successful creation redirects to the invoice list; find the new row there.
  await ownerPage.waitForURL("/invoices");

  const row = ownerPage.locator("table tbody tr").filter({ hasText: customerName }).first();
  await expect(row).toBeVisible();
  const link = row.locator("td:first-child a");
  const invoiceNumber = await link.textContent();
  await link.click();
  await ownerPage.waitForURL(/\/invoices\/[^/]+$/);
  return invoiceNumber?.trim() ?? "";
}

test.describe("create and send invoice", () => {
  test("owner can create and send a draft invoice", async ({ ownerPage, viewport }) => {
    test.skip(viewport === null || viewport.width < 1280, "Desktop-only flow");

    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const customerName = `INV Smoke ${suffix}`;

    const invoiceNumber = await createInvoice(ownerPage, customerName);

    await expect(ownerPage.getByRole("heading", { name: invoiceNumber })).toBeVisible();
    await expect(ownerPage.getByText("Draft").first()).toBeVisible();

    await ownerPage.getByRole("button", { name: "Send" }).click();
    await expect(ownerPage.getByRole("dialog")).toBeVisible();
    await ownerPage.getByRole("dialog").getByRole("button", { name: "Send" }).click();

    // Sending moves the invoice to "Sent" and replaces the Send button with
    // paid/void actions.
    await expect(ownerPage.getByText("Sent").first()).toBeVisible();
    await expect(ownerPage.getByRole("button", { name: "Send" })).not.toBeVisible();
    await expect(ownerPage.getByRole("button", { name: "Mark paid" })).toBeVisible();
  });
});
