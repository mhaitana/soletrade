import type { Page } from "@playwright/test";
import { test, expect, switchWorkspace } from "../fixtures/auth";

/**
 * Role-based access smoke spec.
 *
 * Verifies that each seeded role can load the dashboard and that the primary
 * navigation surfaces the modules each role is permitted to see. Also checks
 * workspace switching for the owner (the only seeded user with two workspaces).
 */
async function expectDashboard(page: Page, workspaceName = "Soletrade Demo Co") {
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { name: workspaceName, level: 1, exact: true }),
  ).toBeVisible();
  await expect(main.getByText("Business overview", { exact: true })).toBeVisible();
  await expect(main.getByRole("region", { name: "Key metrics", exact: true })).toBeVisible();
}

test.describe("auth fixtures", () => {
  test("owner can load dashboard and switch to second workspace", async ({ ownerPage }) => {
    await ownerPage.goto("/dashboard");
    await expectDashboard(ownerPage);

    await switchWorkspace(ownerPage, "Bellflower Studio");
    const switcher = ownerPage.getByRole("button", { name: /switch workspace/i });
    await expect(switcher).toContainText("Bellflower Studio");
    // The mobile navigation sheet stays open after choosing a workspace.
    if (await ownerPage.getByRole("dialog").isVisible()) await ownerPage.keyboard.press("Escape");
    await expectDashboard(ownerPage, "Bellflower Studio");
  });

  test("admin can load dashboard", async ({ adminPage }) => {
    await adminPage.goto("/dashboard");
    await expectDashboard(adminPage);
  });

  test("accountant can load dashboard and books", async ({ accountantPage }) => {
    await accountantPage.goto("/dashboard");
    await expectDashboard(accountantPage);

    await accountantPage.goto("/books");
    await expect(accountantPage.getByRole("heading", { name: /books/i })).toBeVisible();
  });

  test("employee can load dashboard and customers", async ({ employeePage }) => {
    await employeePage.goto("/dashboard");
    await expectDashboard(employeePage);

    await employeePage.goto("/customers");
    await expect(employeePage.getByRole("heading", { name: /customers/i })).toBeVisible();
  });

  test("readonly can load dashboard and view-only pages", async ({ readonlyPage }) => {
    await readonlyPage.goto("/dashboard");
    await expectDashboard(readonlyPage);

    await readonlyPage.goto("/customers");
    await expect(readonlyPage.getByRole("heading", { name: /customers/i })).toBeVisible();
  });

  test("pending user is redirected to onboarding", async ({ pendingPage }) => {
    await pendingPage.goto("/dashboard", { timeout: 60_000, waitUntil: "domcontentloaded" });
    await expect(pendingPage).toHaveURL(/\/onboarding/);
    await expect(
      pendingPage.getByRole("textbox", { name: "Workspace name", exact: true }),
    ).toBeVisible();
    await expect(
      pendingPage.getByRole("button", { name: "Create your workspace", exact: true }),
    ).toBeVisible();
  });
});

test.describe("role-based nav visibility", () => {
  test("readonly does not see audit nav item", async ({ readonlyPage }) => {
    await readonlyPage.goto("/dashboard");
    await expectDashboard(readonlyPage);

    const mobileMenu = readonlyPage.getByRole("button", { name: /open menu/i });
    const isMobile = await mobileMenu.isVisible().catch(() => false);

    if (isMobile) await mobileMenu.click();
    const nav = readonlyPage.getByRole("navigation", { name: "Primary", exact: true });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Audit log", exact: true })).not.toBeVisible();
  });

  test("readonly can view billing without management actions", async ({ readonlyPage }) => {
    await readonlyPage.goto("/billing");
    await expect(readonlyPage.getByRole("heading", { name: /billing/i })).toBeVisible();
    await expect(readonlyPage.getByRole("button", { name: /start billing/i })).not.toBeVisible();
  });

  test("employee is blocked from billing", async ({ employeePage }) => {
    await employeePage.goto("/billing");
    await expect(
      employeePage.getByText(/you don't have permission to view billing/i),
    ).toBeVisible();
  });
});
