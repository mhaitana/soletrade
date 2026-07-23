import { expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { switchWorkspace, test } from "../fixtures/auth";

/**
 * Invite-member smoke flow (F006).
 *
 * The owner fixture invites a new member by email in the seeded workspace and
 * asserts that a pending invitation row appears.
 */

const ACTIVE_WORKSPACE = "Soletrade Demo Co";

test.describe("invite member", () => {
  test("owner can invite a new member and sees a pending invitation", async ({
    ownerPage,
    viewport,
  }) => {
    test.skip(viewport === null || viewport.width < 1280, "Desktop-only flow");

    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const email = `f006-invite-${suffix}@example.com`;

    await ownerPage.goto("/settings/members", { waitUntil: "networkidle" });
    await switchWorkspace(ownerPage, ACTIVE_WORKSPACE);

    await ownerPage.getByLabel("Email", { exact: true }).fill(email);
    await ownerPage.locator("#invite-role").selectOption("accountant");
    await ownerPage.getByRole("button", { name: "Send invite" }).click();

    const pendingSection = ownerPage
      .locator("div")
      .filter({ has: ownerPage.getByRole("heading", { name: /pending invitations/i }) })
      .last();
    await expect(pendingSection.getByText(email)).toBeVisible();
    await expect(pendingSection.getByText("Accountant").first()).toBeVisible();
  });
});
