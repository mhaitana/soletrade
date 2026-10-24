import { describe, expect, it } from "vitest";
import {
  ModuleNotEnabledError,
  resolveActiveModules,
} from "@/server/foundation/module-installations";
import type { ModuleKey } from "@/config/modules";

describe("resolveActiveModules (pure gating predicate)", () => {
  type Row = { moduleKey: ModuleKey; status: "active" | "cancelled"; cancelledAt: Date | null };

  it("keeps active rows with no cancelledAt", () => {
    const rows: Row[] = [
      { moduleKey: "invoices", status: "active", cancelledAt: null },
      { moduleKey: "books", status: "active", cancelledAt: null },
    ];
    expect(resolveActiveModules(rows)).toEqual(["invoices", "books"]);
  });

  it("drops cancelled rows even if status stale", () => {
    const rows: Row[] = [
      { moduleKey: "invoices", status: "active", cancelledAt: null },
      { moduleKey: "drive", status: "cancelled", cancelledAt: new Date() },
    ];
    expect(resolveActiveModules(rows)).toEqual(["invoices"]);
  });

  it("drops rows where cancelledAt is set regardless of status label", () => {
    // Defensive: cancelledAt should be the source of truth.
    const rows: Row[] = [
      { moduleKey: "invoices", status: "active", cancelledAt: null },
      { moduleKey: "quotes", status: "active", cancelledAt: new Date() },
    ];
    expect(resolveActiveModules(rows)).toEqual(["invoices"]);
  });

  it("returns empty array when nothing is installed", () => {
    expect(resolveActiveModules([])).toEqual([]);
  });

  it("preserves order of input", () => {
    const rows: Row[] = [
      { moduleKey: "drive", status: "active", cancelledAt: null },
      { moduleKey: "invoices", status: "active", cancelledAt: null },
    ];
    expect(resolveActiveModules(rows)).toEqual(["drive", "invoices"]);
  });
});

describe("ModuleNotEnabledError", () => {
  it("carries the module key and a readable message", () => {
    const err = new ModuleNotEnabledError("books");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ModuleNotEnabledError");
    expect(err.moduleKey).toBe("books");
    expect(err.message).toContain("books");
  });
});
