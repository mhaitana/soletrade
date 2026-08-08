import { expect, switchWorkspace, test } from "./fixtures/auth";

/**
 * Core dashboard smoke flow (F006).
 *
 * Verifies that seeded roles can land on the dashboard, see headline KPI cards,
 * and (for the owner) switch workspaces without leaving the app.
 */

const ACTIVE_WORKSPACE = "Soletrade Demo Co";

test.describe("dashboard smoke", () => {
  test("owner sees dashboard KPIs and can switch workspace", async ({ ownerPage, viewport }) => {
    test.skip(viewport === null || viewport.width < 1280, "Desktop-only flow");

    await ownerPage.goto("/dashboard", { waitUntil: "networkidle" });
    await expect(ownerPage.getByRole("heading", { level: 1 })).toBeVisible();

    // Four headline KPI cards are rendered.
    await expect(ownerPage.getByText("Outstanding invoices").first()).toBeVisible();
    await expect(ownerPage.getByText("Total income").first()).toBeVisible();
    await expect(ownerPage.getByText("Net cash flow").first()).toBeVisible();
    await expect(ownerPage.getByText("Ready to invoice").first()).toBeVisible();

    await switchWorkspace(ownerPage, ACTIVE_WORKSPACE);
    const switcher = ownerPage.getByRole("button", { name: /switch workspace/i });
    await expect(switcher).toContainText(ACTIVE_WORKSPACE);
  });

  test("admin sees dashboard on desktop", async ({ adminPage, viewport }) => {
    test.skip(viewport === null || viewport.width < 1280, "Desktop-only flow");

    await adminPage.goto("/dashboard", { waitUntil: "networkidle" });
    await expect(adminPage.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(adminPage.getByText("Outstanding invoices").first()).toBeVisible();
  });

  test("dashboard is reachable on iPhone without horizontal overflow", async ({
    ownerPage,
    viewport,
  }) => {
    test.skip(viewport === null || viewport.width >= 768, "Only narrow mobile viewports");

    await ownerPage.goto("/dashboard", { waitUntil: "networkidle" });
    await expect(ownerPage.getByRole("heading", { level: 1 })).toBeVisible();

    const overflow = await ownerPage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow, "dashboard has horizontal overflow").toBe(false);

    const periodMenu = ownerPage.getByRole("button", { name: /dashboard period/i });
    await expect(periodMenu).toBeVisible();
    const periodBox = await periodMenu.boundingBox();
    expect(periodBox?.height, "mobile period menu should stay compact").toBeLessThanOrEqual(48);

    const firstKpi = ownerPage.getByRole("link", { name: /net cash flow:/i });
    const secondKpi = ownerPage.getByRole("link", { name: /outstanding invoices:/i });
    const [firstKpiBox, secondKpiBox] = await Promise.all([
      firstKpi.boundingBox(),
      secondKpi.boundingBox(),
    ]);
    expect(firstKpiBox?.y, "first two KPIs should share a compact mobile row").toBe(
      secondKpiBox?.y,
    );
  });
});
