import { describe, expect, it } from "vitest";
import { buildNav } from "@/config/navigation";
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
