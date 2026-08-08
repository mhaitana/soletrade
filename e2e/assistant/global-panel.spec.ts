import { expect, test } from "../fixtures/auth";

test.describe("global hAI assistant", () => {
  test("navigates safely and prepares a review-only invoice draft", async ({
    ownerPage,
    viewport,
  }) => {
    expect(viewport, "The hAI responsive test requires a configured viewport").not.toBeNull();
    const compact = viewport!.width < 1280;

    await ownerPage.goto("/dashboard", { waitUntil: "networkidle" });
    await expect
      .poll(() =>
        ownerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      )
      .toBe(true);
    const toggle = ownerPage.getByRole("button", { name: "hAI", exact: true });
    await toggle.click();

    const panel = ownerPage.getByRole("complementary", { name: "hAI global assistant" });
    await expect(panel).toBeVisible();

    const message = panel.getByLabel("Message hAI");
    if (compact) {
      const toggleBox = await toggle.boundingBox();
      expect(toggleBox, "The mobile hAI toggle needs a measurable touch target").not.toBeNull();
      expect(toggleBox!.height).toBeGreaterThanOrEqual(44);
      expect(toggleBox!.width).toBeGreaterThanOrEqual(44);

      await expect
        .poll(async () => {
          const box = await panel.boundingBox();
          return box ? box.x + box.width : Number.POSITIVE_INFINITY;
        })
        .toBeLessThanOrEqual(viewport!.width + 0.5);
      const panelBox = await panel.boundingBox();
      expect(panelBox, "The mobile hAI panel should render in the viewport").not.toBeNull();
      expect(panelBox!.x).toBeGreaterThanOrEqual(0);
      expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport!.width + 0.5);
      expect(panelBox!.height).toBeLessThanOrEqual(viewport!.height);

      const composerBox = await message.boundingBox();
      expect(composerBox, "The hAI composer should remain visible on mobile").not.toBeNull();
      expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(viewport!.height);

      const close = panel.getByRole("button", { name: "Close hAI" });
      const closeBox = await close.boundingBox();
      expect(closeBox, "The mobile hAI close control needs a touch target").not.toBeNull();
      expect(closeBox!.height).toBeGreaterThanOrEqual(44);
      expect(closeBox!.width).toBeGreaterThanOrEqual(44);

      for (const control of [
        panel.getByRole("button", { name: "Start a new hAI conversation" }),
        panel.getByRole("button", { name: "Send message" }),
      ]) {
        const controlBox = await control.boundingBox();
        expect(controlBox, "Mobile hAI controls need measurable touch targets").not.toBeNull();
        expect(controlBox!.height).toBeGreaterThanOrEqual(44);
        expect(controlBox!.width).toBeGreaterThanOrEqual(44);
      }

      await close.click();
      await expect(panel).not.toBeVisible();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await expect(panel).toBeVisible();
    }

    await message.fill("Open overdue invoices");
    await message.press("Enter");
    await ownerPage.waitForURL(/\/invoices\?status=overdue$/);
    await expect(panel).toBeVisible();
    await expect(panel.getByText("This navigation does not change business data.")).toBeVisible();

    await message.fill("Draft an invoice for Acme Corp for $250");
    await message.press("Enter");
    await ownerPage.waitForURL(/\/invoices\/new$/);

    await expect(panel).toBeVisible();
    await expect(panel.getByText("Context: /invoices/new")).toBeVisible();
    if (compact) {
      await panel.getByRole("button", { name: "Close hAI" }).click();
      await expect(panel).not.toBeVisible();
      await expect
        .poll(() =>
          ownerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        )
        .toBe(true);
    }
    const draftNotice = ownerPage.getByRole("complementary", { name: "hAI assisted draft" });
    await expect(draftNotice.getByText("hAI prepared an unsaved draft")).toBeVisible();
    await expect(draftNotice.getByText(/nothing has been saved or sent/i)).toBeVisible();
    await expect(ownerPage.getByLabel("Customer")).toHaveValue(
      "11111111-1111-4111-8111-111111110101",
    );
    await expect(ownerPage.getByLabel("Line 1 unit price")).toHaveValue("250.00");
    await expect(ownerPage.getByLabel("Line 1 description")).toHaveValue("");
    await expect(ownerPage.getByRole("button", { name: "Create invoice" })).toBeVisible();

    // The handoff is client-only and one-shot. Reloading before submission loses
    // the draft values and proves the assistant did not persist an invoice.
    await ownerPage.reload({ waitUntil: "networkidle" });
    await expect(ownerPage).toHaveURL(/\/invoices\/new$/);
    await expect(ownerPage.getByLabel("Customer")).toHaveValue("");
    await expect(ownerPage.getByLabel("Line 1 unit price")).toHaveValue("");
    await expect(
      ownerPage.getByRole("complementary", { name: "hAI assisted draft" }),
    ).not.toBeVisible();
  });
});
