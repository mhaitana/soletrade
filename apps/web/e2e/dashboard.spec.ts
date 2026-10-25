import { expect, switchWorkspace, test } from "./fixtures/auth";

/**
 * Core dashboard smoke flow (F006).
 *
 * Verifies that seeded roles can land on the dashboard, see headline KPI cards,
 * and (for the owner) switch workspaces without leaving the app.
 */

const ACTIVE_WORKSPACE = "Soletrade Demo Co";
const SECOND_WORKSPACE = "Bellflower Studio";

test.describe("dashboard smoke", () => {
  test("owner sees dashboard KPIs and can switch workspace", async ({ ownerPage, viewport }) => {
    test.skip(viewport === null || viewport.width < 1280, "Desktop-only flow");

    await ownerPage.goto("/dashboard", { waitUntil: "networkidle" });
    const main = ownerPage.getByRole("main");
    await expect(
      main.getByRole("heading", { name: ACTIVE_WORKSPACE, level: 1, exact: true }),
    ).toBeVisible();
    await expect(main.getByText("Business overview", { exact: true })).toBeVisible();

    // Four headline KPI cards are rendered.
    const metrics = main.getByRole("region", { name: "Key metrics", exact: true });
    await expect(metrics.getByRole("link", { name: /^Outstanding invoices:/ })).toBeVisible();
    await expect(metrics.getByRole("link", { name: /^Total income:/ })).toBeVisible();
    await expect(metrics.getByRole("link", { name: /^Net cash flow:/ })).toBeVisible();
    await expect(metrics.getByRole("link", { name: /^Ready to invoice:/ })).toBeVisible();

    await switchWorkspace(ownerPage, SECOND_WORKSPACE);
    const switcher = ownerPage.getByRole("button", { name: /switch workspace/i });
    await expect(switcher).toContainText(SECOND_WORKSPACE);
    await expect(
      main.getByRole("heading", { name: SECOND_WORKSPACE, level: 1, exact: true }),
    ).toBeVisible();
    await expect(metrics).toBeVisible();
  });

  test("admin sees dashboard on desktop", async ({ adminPage, viewport }) => {
    test.skip(viewport === null || viewport.width < 1280, "Desktop-only flow");

    await adminPage.goto("/dashboard", { waitUntil: "networkidle" });
    const main = adminPage.getByRole("main");
    await expect(
      main.getByRole("heading", { name: ACTIVE_WORKSPACE, level: 1, exact: true }),
    ).toBeVisible();
    await expect(main.getByText("Business overview", { exact: true })).toBeVisible();
    await expect(
      main
        .getByRole("region", { name: "Key metrics", exact: true })
        .getByRole("link", { name: /^Outstanding invoices:/ }),
    ).toBeVisible();
  });

  test("dashboard is reachable on iPhone without horizontal overflow", async ({
    ownerPage,
    viewport,
  }) => {
    test.skip(viewport === null || viewport.width >= 768, "Only narrow mobile viewports");

    await ownerPage.goto("/dashboard", { waitUntil: "networkidle" });
    const main = ownerPage.getByRole("main");
    await expect(
      main.getByRole("heading", { name: ACTIVE_WORKSPACE, level: 1, exact: true }),
    ).toBeVisible();
    await expect(main.getByText("Business overview", { exact: true })).toBeVisible();

    const overflow = await ownerPage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow, "dashboard has horizontal overflow").toBe(false);

    const periodMenu = ownerPage.getByRole("button", { name: /dashboard period/i });
    await expect(periodMenu).toBeVisible();
    const periodBox = await periodMenu.boundingBox();
    expect(periodBox?.height, "mobile period menu should stay compact").toBeLessThanOrEqual(48);

    const metrics = main.getByRole("region", { name: "Key metrics", exact: true });
    const firstKpi = metrics.getByRole("link", { name: /^Net cash flow:/ });
    const secondKpi = metrics.getByRole("link", { name: /^Outstanding invoices:/ });
    await expect(firstKpi).toBeVisible();
    await expect(secondKpi).toBeVisible();
    const [firstKpiBox, secondKpiBox] = await Promise.all([
      firstKpi.boundingBox(),
      secondKpi.boundingBox(),
    ]);
    expect(firstKpiBox).not.toBeNull();
    expect(secondKpiBox).not.toBeNull();
    expect(firstKpiBox!.y, "first two KPIs should share a compact mobile row").toBe(
      secondKpiBox!.y,
    );
  });
});
