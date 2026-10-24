import { describe, expect, it } from "vitest";
import {
  AuthorizationError,
  authorize,
  can,
  requirePermission,
  ROLES,
  type Permission,
  type Role,
} from "@/lib/domain/permissions";

describe("permissions matrix", () => {
  type Case = { role: Role; perm: Permission; expected: boolean };
  const cases: Case[] = [
    // Owner: everything, incl. owner-only destructive workspace perms.
    { role: "owner", perm: "delete:workspace", expected: true },
    { role: "owner", perm: "transfer:workspace", expected: true },
    { role: "owner", perm: "manage:billing", expected: true },
    { role: "owner", perm: "manage:module", expected: true },
    { role: "owner", perm: "view:audit", expected: true },

    // Admin: same as owner MINUS delete:workspace / transfer:workspace.
    { role: "admin", perm: "delete:workspace", expected: false },
    { role: "admin", perm: "transfer:workspace", expected: false },
    { role: "admin", perm: "manage:billing", expected: true },
    { role: "admin", perm: "manage:module", expected: true },
    { role: "admin", perm: "manage:member", expected: true },

    // Manager: can manage customers/invoices/quotes/drive and invite members,
    // but NOT billing/modules/books.
    { role: "manager", perm: "manage:customer", expected: true },
    { role: "manager", perm: "manage:invoice", expected: true },
    { role: "manager", perm: "manage:quote", expected: true },
    { role: "manager", perm: "invite:member", expected: true },
    { role: "manager", perm: "view:member", expected: true },
    { role: "manager", perm: "manage:billing", expected: false },
    { role: "manager", perm: "manage:module", expected: false },
    { role: "manager", perm: "manage:books", expected: false },
    { role: "manager", perm: "delete:workspace", expected: false },

    // Accountant: customer/invoice/quote/books/file + audit view; NO drive/modules/billing-manage.
    { role: "accountant", perm: "manage:books", expected: true },
    { role: "accountant", perm: "manage:invoice", expected: true },
    { role: "accountant", perm: "manage:quote", expected: true },
    { role: "accountant", perm: "view:audit", expected: true },
    { role: "accountant", perm: "manage:drive", expected: false },
    { role: "accountant", perm: "manage:billing", expected: false },
    { role: "accountant", perm: "manage:module", expected: false },

    // Employee: can create invoices/quotes and manage customers/drive/files, but not books/billing.
    { role: "employee", perm: "create:invoice", expected: true },
    { role: "employee", perm: "create:quote", expected: true },
    { role: "employee", perm: "manage:customer", expected: true },
    { role: "employee", perm: "manage:drive", expected: true },
    { role: "employee", perm: "manage:books", expected: false },
    { role: "employee", perm: "manage:billing", expected: false },
    { role: "employee", perm: "invite:member", expected: false },
    { role: "employee", perm: "delete:workspace", expected: false },

    // Readonly: view everything listed, create/update/delete nothing.
    { role: "readonly", perm: "view:workspace", expected: true },
    { role: "readonly", perm: "view:billing", expected: true },
    { role: "readonly", perm: "view:customer", expected: true },
    { role: "readonly", perm: "view:audit", expected: false }, // readonly role is NOT granted view:audit
    { role: "readonly", perm: "create:invoice", expected: false },
    { role: "readonly", perm: "update:customer", expected: false },
    { role: "readonly", perm: "delete:invoice", expected: false },
    { role: "readonly", perm: "manage:customer", expected: false },
  ];

  for (const { role, perm, expected } of cases) {
    it(`${expected ? "grants" : "denies"} ${role} → ${perm}`, () => {
      expect(can(role, perm)).toBe(expected);
    });
  }
});

describe("implication rules", () => {
  it("manage implies every verb on the resource, incl. delete", () => {
    expect(can("owner", "delete:invoice")).toBe(true);
    expect(can("owner", "update:invoice")).toBe(true);
    expect(can("owner", "create:invoice")).toBe(true);
    expect(can("owner", "view:invoice")).toBe(true);
  });

  it("create does NOT imply delete/update (non-manage verbs are independent)", () => {
    // employee has create:invoice but should not get delete:invoice
    expect(can("employee", "create:invoice")).toBe(true);
    expect(can("employee", "delete:invoice")).toBe(false);
    expect(can("employee", "update:invoice")).toBe(false);
  });

  it("any grant on a resource implies view on that resource", () => {
    // manager has manage:customer → view:customer
    expect(can("manager", "view:customer")).toBe(true);
    // employee has create:quote (not manage:quote) → still view:quote
    expect(can("employee", "view:quote")).toBe(true);
  });

  it("view does NOT imply any other verb", () => {
    // readonly has view:invoice only - must not get create/update/delete/manage
    expect(can("readonly", "manage:invoice")).toBe(false);
    expect(can("readonly", "create:invoice")).toBe(false);
  });

  it("manage:member implies invite:member and view:member", () => {
    expect(can("owner", "invite:member")).toBe(true);
    expect(can("admin", "invite:member")).toBe(true);
    // manager is explicitly granted invite:member, not manage:member
    expect(can("manager", "manage:member")).toBe(false);
    expect(can("manager", "invite:member")).toBe(true);
  });
});

describe("authorize / requirePermission", () => {
  it("authorize returns ok:true when permitted", () => {
    expect(authorize("owner", "manage:billing")).toEqual({ ok: true });
  });

  it("authorize returns insufficient_role when denied", () => {
    expect(authorize("employee", "manage:billing")).toEqual({
      ok: false,
      reason: "insufficient_role",
    });
  });

  it("requirePermission throws AuthorizationError with insufficient_role reason", () => {
    expect(() => requirePermission("employee", "manage:billing")).toThrow(AuthorizationError);
    try {
      requirePermission("employee", "manage:billing");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthorizationError);
      expect((err as AuthorizationError).reason).toBe("insufficient_role");
    }
  });

  it("requirePermission does not throw when permitted", () => {
    expect(() => requirePermission("admin", "manage:billing")).not.toThrow();
  });
});

describe("ROLES registry", () => {
  it("exposes all six roles in order", () => {
    expect([...ROLES]).toEqual(["owner", "admin", "manager", "accountant", "employee", "readonly"]);
  });
});
