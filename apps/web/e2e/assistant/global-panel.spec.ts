import { expect, test } from "../fixtures/auth";

test.describe("global hAI assistant", () => {
  test("answers from workspace evidence and persists the conversation to History", async ({
    ownerPage,
  }) => {
    const hydrationErrors: string[] = [];
    ownerPage.on("console", (message) => {
      if (message.type() === "error" && /hydration failed/i.test(message.text())) {
        hydrationErrors.push(message.text());
      }
    });
    ownerPage.on("pageerror", (error) => {
      if (/hydration failed/i.test(error.message)) hydrationErrors.push(error.message);
    });

    await ownerPage.goto("/dashboard", { waitUntil: "networkidle" });
    // Other browser projects create invoices and accept quotes in this shared
    // workspace. Compare the assistant with the current dashboard evidence.
    const outstanding = await ownerPage
      .getByRole("link", { name: /^Outstanding invoices:/ })
      .getAttribute("aria-label");
    const readyToInvoice = await ownerPage
      .getByRole("link", { name: /^Ready to invoice:/ })
      .getAttribute("aria-label");
    expect(outstanding).toMatch(/^Outstanding invoices: \$[\d,]+\.\d{2}$/);
    expect(readyToInvoice).toMatch(/^Ready to invoice: \$[\d,]+\.\d{2}$/);
    const overdue = await ownerPage.getByText(/^\d+ overdue invoices?$/).textContent();
    expect(overdue).toMatch(/^\d+ overdue invoices?$/);
    const outstandingEvidence = `${outstanding} (${overdue!.match(/^\d+/)![0]} overdue)`;
    const acceptedQuotesEvidence = readyToInvoice!.replace(
      "Ready to invoice:",
      "Ready to invoice (accepted quotes):",
    );
    await ownerPage.getByRole("button", { name: "hAI", exact: true }).click();

    const panel = ownerPage.getByRole("dialog", { name: "hAI global assistant" });
    await expect(panel.getByText("Context: /dashboard")).toBeVisible();
    await panel.getByRole("button", { name: "What should I pay attention to here?" }).click();

    await expect(
      panel.getByText(/Here's a snapshot of your workspace \(current month\):/),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      panel.getByText(/Installed modules: invoices, books, drive, quotes/),
    ).toBeVisible();
    await expect(panel.getByText(outstandingEvidence)).toBeVisible();
    await expect(panel.getByText(acceptedQuotesEvidence)).toBeVisible();

    // History is a view of the panel itself: the conversation is listed there,
    // marked as the one in the chat, and the page underneath does not change.
    await panel.getByRole("button", { name: "History" }).click();
    await expect(panel.getByRole("heading", { name: "History" })).toBeVisible();
    await expect(
      panel.getByRole("list", { name: "Conversations" }).locator('[aria-current="true"]'),
    ).toContainText("What should I pay attention to here?");
    await expect(ownerPage).toHaveURL(/\/dashboard$/);

    const fullPage = panel.getByRole("link", { name: "Open full page" });
    const historyHref = await fullPage.getAttribute("href");
    expect(historyHref).toMatch(/^\/assistant\?c=[0-9a-f-]{36}$/);
    await fullPage.click();
    await ownerPage.waitForURL(/\/assistant\?c=[0-9a-f-]{36}$/);

    // Opening the full page closes the panel. A hard reload then proves both
    // turns in the server-rendered transcript came from the database.
    await expect(panel).not.toBeVisible();
    const main = ownerPage.locator("main");
    await expect(
      main.getByText("What should I pay attention to here?", { exact: true }).last(),
    ).toBeVisible();
    await expect(
      main.getByText(/Here's a snapshot of your workspace \(current month\):/),
    ).toBeVisible();

    await ownerPage.reload({ waitUntil: "networkidle" });
    await expect(ownerPage).toHaveURL(new RegExp(`${historyHref!.replace("?", "\\?")}$`));
    await expect(
      main.getByText("What should I pay attention to here?", { exact: true }).last(),
    ).toBeVisible();
    await expect(main.getByText(outstandingEvidence)).toBeVisible();
    expect(hydrationErrors).toEqual([]);
  });

  test("keeps restricted draft requests on the current page without creating data", async ({
    readonlyPage,
  }) => {
    await readonlyPage.goto("/dashboard", { waitUntil: "networkidle" });
    await readonlyPage.getByRole("button", { name: "hAI", exact: true }).click();

    const panel = readonlyPage.getByRole("dialog", { name: "hAI global assistant" });
    const message = panel.getByLabel("Message hAI");
    await message.fill("Draft an invoice for Acme Corp for $250");
    await message.press("Enter");

    await expect(panel.getByText(/don't have permission to open new invoice/i).first()).toBeVisible(
      {
        timeout: 20_000,
      },
    );
    await expect(readonlyPage).toHaveURL(/\/dashboard$/);
    await panel.getByRole("button", { name: "Close hAI" }).click();
    await expect(
      readonlyPage.getByRole("complementary", { name: "hAI assisted draft" }),
    ).not.toBeVisible();
  });

  test("navigates safely and prepares a review-only invoice draft", async ({
    ownerPage,
    viewport,
  }) => {
    expect(viewport, "The hAI responsive test requires a configured viewport").not.toBeNull();
    expect(ownerPage.viewportSize(), "The auth fixture must inherit the project viewport").toEqual(
      viewport,
    );
    const compact = viewport!.width < 1280;

    await ownerPage.goto("/dashboard", { waitUntil: "networkidle" });
    await expect
      .poll(() =>
        ownerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      )
      .toBe(true);
    const toggle = ownerPage.getByRole("button", { name: "hAI", exact: true });
    if (compact) {
      const toggleBox = await toggle.boundingBox();
      expect(toggleBox, "The mobile hAI toggle needs a measurable touch target").not.toBeNull();
      expect(toggleBox!.height).toBeGreaterThanOrEqual(44);
      expect(toggleBox!.width).toBeGreaterThanOrEqual(44);
    }
    await toggle.click();

    const panel = ownerPage.getByRole("dialog", { name: "hAI global assistant" });
    await expect(panel).toBeVisible();

    const message = panel.getByLabel("Message hAI");
    if (compact) {
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
    if ((await panel.getAttribute("aria-modal")) === "true") {
      await panel.getByRole("button", { name: "Close hAI" }).click();
      await expect(panel).not.toBeVisible();
    }
    if (compact) {
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
