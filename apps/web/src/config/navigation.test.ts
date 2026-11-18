import { describe, expect, it } from "vitest";
import { buildCreateActions, buildNav, buildSecondaryNav } from "@/config/navigation";
import type { WorkspaceRole } from "@/lib/domain/database-enums";

describe("workspace navigation permissions", () => {
  it.each<[WorkspaceRole, boolean]>([
    ["owner", true],
    ["admin", true],
    ["accountant", true],
    ["manager", false],
    ["employee", false],
    ["readonly", false],
  ])("shows Audit log for %s only when permitted", (role, auditVisible) => {
    const navigation = buildNav(["books", "invoices"], role);

    expect(navigation.some((item) => item.href === "/audit")).toBe(auditVisible);
    expect(navigation.map((item) => item.href)).toEqual(
      expect.arrayContaining(["/dashboard", "/books", "/invoices", "/customers", "/activity"]),
    );
  });
});

describe("sub-pages without a sidebar entry", () => {
  it("lists Books and Drive sub-pages only for installed modules", () => {
    const hrefs = (modules: Parameters<typeof buildSecondaryNav>[0]) =>
      buildSecondaryNav(modules, "owner").map((item) => item.href);

    expect(hrefs(["books"])).toEqual(expect.arrayContaining(["/books/receipts", "/books/tax"]));
    expect(hrefs(["books"])).not.toContain("/drive/vehicles");
    expect(hrefs(["drive"])).toEqual(
      expect.arrayContaining(["/drive/vehicles", "/drive/expenses", "/drive/settings"]),
    );
    expect(hrefs([])).toEqual(
      expect.arrayContaining(["/notifications", "/settings/account", "/settings/members"]),
    );
  });

  it("shows Modules settings only to roles that can manage modules", () => {
    const has = (role: WorkspaceRole) =>
      buildSecondaryNav([], role).some((item) => item.href === "/settings/modules");
    expect(has("owner")).toBe(true);
    expect(has("readonly")).toBe(false);
  });
});

describe("create actions", () => {
  it("follows installed modules and the role's create permissions", () => {
    expect(buildCreateActions(["invoices", "drive"], "owner").map((a) => a.href)).toEqual([
      "/invoices/new",
      "/drive/new",
      "/customers/new",
    ]);
    expect(buildCreateActions(["invoices", "drive"], "readonly")).toEqual([]);
  });
});
