import { expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { switchWorkspace, test } from "../fixtures/auth";

/**
 * Books create-transaction smoke flow (F006).
 *
 * The owner fixture records a new income transaction in the seeded workspace and
 * asserts it appears in the Books list.
 */

const ACTIVE_WORKSPACE = "Soletrade Demo Co";

test.describe("create books transaction", () => {
  test("owner can create an income transaction and see it in the list", async ({
    ownerPage,
    viewport,
  }) => {
    test.skip(viewport === null || viewport.width < 1280, "Desktop-only flow");

    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const description = `F006 Books smoke ${suffix}`;

    await ownerPage.goto("/books/new", { waitUntil: "networkidle" });
    await switchWorkspace(ownerPage, ACTIVE_WORKSPACE);

    await ownerPage.getByLabel("Amount", { exact: true }).fill("275.00");
    await ownerPage.getByLabel("Description", { exact: true }).fill(description);
    await ownerPage.locator("#type").selectOption("income");

    const submit = ownerPage.getByRole("button", { name: "Record transaction" });
    await submit.scrollIntoViewIfNeeded();
    await submit.click();
    await ownerPage.waitForURL("/books");

    await expect(ownerPage.getByRole("heading", { name: /books/i })).toBeVisible();
    await expect(
      ownerPage.locator("table tbody tr").filter({ hasText: description }).first(),
    ).toBeVisible();
    await expect(
      ownerPage
        .locator("table tbody tr")
        .filter({ hasText: description })
        .getByText("Income")
        .first(),
    ).toBeVisible();
  });
});
