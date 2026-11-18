import { describe, expect, it } from "vitest";
import type { ModuleKey, WorkspaceRole } from "@/lib/domain/database-enums";
import { insightScope } from "@/lib/domain/insights/facts";
import { ROLES } from "@/lib/domain/permissions/index";

const ALL_MODULES: ModuleKey[] = ["invoices", "books", "drive", "quotes"];

describe("insightScope", () => {
  it("covers nothing when no module is installed, whatever the role", () => {
    for (const role of ROLES) {
      expect(insightScope(role, [])).toEqual({
        invoices: false,
        quotes: false,
        receipts: false,
        gst: false,
      });
    }
  });

  it("covers an area only when its module is installed", () => {
    expect(insightScope("owner", ["invoices"])).toEqual({
      invoices: true,
      quotes: false,
      receipts: false,
      gst: false,
    });
    expect(insightScope("owner", ["quotes"])).toMatchObject({ invoices: false, quotes: true });
    expect(insightScope("owner", ["books"])).toEqual({
      invoices: false,
      quotes: false,
      receipts: true,
      gst: true,
    });
    // Drive has no facts of its own.
    expect(insightScope("owner", ["drive"])).toEqual({
      invoices: false,
      quotes: false,
      receipts: false,
      gst: false,
    });
  });

  it("gives each role only the Books facts its permissions allow", () => {
    const books = (role: WorkspaceRole) => {
      const { receipts, gst } = insightScope(role, ALL_MODULES);
      return { receipts, gst };
    };
    // Owners, admins and accountants manage Books: review queue and GST.
    expect(books("owner")).toEqual({ receipts: true, gst: true });
    expect(books("admin")).toEqual({ receipts: true, gst: true });
    expect(books("accountant")).toEqual({ receipts: true, gst: true });
    // Managers and read-only members can see Books but not review receipts.
    expect(books("manager")).toEqual({ receipts: false, gst: true });
    expect(books("readonly")).toEqual({ receipts: false, gst: true });
    // Employees cannot see Books at all.
    expect(books("employee")).toEqual({ receipts: false, gst: false });
  });

  it("lets every current role see invoice and quote facts, as the dashboard does", () => {
    for (const role of ROLES) {
      expect(insightScope(role, ALL_MODULES)).toMatchObject({ invoices: true, quotes: true });
    }
  });
});
