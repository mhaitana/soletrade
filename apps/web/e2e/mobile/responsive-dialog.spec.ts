import { expect } from "@playwright/test";
import { switchWorkspace, test } from "../fixtures/auth";

/**
 * ResponsiveDialog behavioural audit (F003).
 *
 * The members-page remove confirmation uses ResponsiveDialog. On narrow viewports
 * it should render as a Radix Sheet (bottom sheet); on desktop it should render
 * as a centered Radix Dialog.
 */

const ACTIVE_WORKSPACE = "Soletrade Demo Co";

test.describe.configure({ mode: "parallel" });

test("members remove confirmation renders as a bottom sheet at 390px", async ({
  ownerPage: page,
  viewport,
}) => {
  test.skip(
    viewport === null || viewport.width >= 768,
    "Only narrow viewports render a bottom sheet",
  );

  await page.goto("/settings/members", { waitUntil: "networkidle" });
  await switchWorkspace(page, ACTIVE_WORKSPACE);

  // The mobile navigation sheet stays open after picking a workspace; close it
  // so the members list is reachable.
  await page
    .getByRole("button", { name: /^Close$/ })
    .first()
    .click();

  // The owner can't remove themselves; target the first remove button for another member.
  const removeButton = page.getByRole("button", { name: /^Remove / }).first();
  await expect(removeButton).toBeVisible();
  await removeButton.click();

  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();

  const dialog = page.locator('[data-slot="dialog-content"]');
  await expect(dialog).not.toBeVisible();
});

test("members remove confirmation renders as a centered dialog at 1280px", async ({
  ownerPage: page,
  viewport,
}) => {
  test.skip(
    viewport === null || viewport.width < 768,
    "Only desktop viewports render a centered dialog",
  );
  await page.goto("/settings/members", { waitUntil: "networkidle" });
  await switchWorkspace(page, ACTIVE_WORKSPACE);

  const removeButton = page.getByRole("button", { name: /^Remove / }).first();
  await expect(removeButton).toBeVisible();
  await removeButton.click();

  const dialog = page.locator('[data-slot="dialog-content"]');
  await expect(dialog).toBeVisible();

  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).not.toBeVisible();
});
