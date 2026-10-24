import { describe, expect, it } from "vitest";
import { getCancellationOptions } from "@/lib/domain/billing/cancellation";

const ANCHOR = new Date(Date.UTC(2026, 0, 1, 0, 0, 0)); // 2026-01-01T00:00:00Z

describe("cancellation engine - getCancellationOptions", () => {
  describe("Branch A - continuous (≥1 other module stays active)", () => {
    it("offers all 3 options with credit recommended", () => {
      const now = new Date(ANCHOR.getTime() + 1_000);
      const res = getCancellationOptions({
        activeModules: ["books", "invoices"],
        moduleKey: "invoices",
        interval: "monthly",
        anchorBillingDate: ANCHOR,
        now,
      });
      expect(res.branch).toBe("continuous");
      const opts = res.options.map((o) => o.option);
      expect(opts).toEqual(["keep_until_end_of_cycle", "immediate_credit", "immediate_refund"]);
      const recommended = res.options.filter((o) => o.recommended);
      expect(recommended.map((o) => o.option)).toEqual(["immediate_credit"]);
    });

    it("credit and refund carry the same pro-rated amount", () => {
      // Half period → Invoices addon monthly 350 → 175.
      const now = new Date(ANCHOR.getTime() + 15 * 86_400_000);
      const res = getCancellationOptions({
        activeModules: ["books", "invoices"],
        moduleKey: "invoices",
        interval: "monthly",
        anchorBillingDate: ANCHOR,
        now,
      });
      const credit = res.options.find((o) => o.option === "immediate_credit");
      const refund = res.options.find((o) => o.option === "immediate_refund");
      expect(credit?.amountCents).toBe(175);
      expect(refund?.amountCents).toBe(175);
      const keep = res.options.find((o) => o.option === "keep_until_end_of_cycle");
      expect(keep?.amountCents).toBe(0);
    });

    it("keep is not recommended in Branch A", () => {
      const now = new Date(ANCHOR.getTime() + 1_000);
      const res = getCancellationOptions({
        activeModules: ["books", "drive", "invoices"],
        moduleKey: "drive",
        interval: "monthly",
        anchorBillingDate: ANCHOR,
        now,
      });
      expect(res.options.find((o) => o.option === "keep_until_end_of_cycle")?.recommended).toBe(
        false,
      );
    });

    it("periodEnd is the next anchor anniversary", () => {
      const now = new Date(ANCHOR.getTime() + 5 * 86_400_000); // +5 days
      const res = getCancellationOptions({
        activeModules: ["books", "invoices"],
        moduleKey: "invoices",
        interval: "monthly",
        anchorBillingDate: ANCHOR,
        now,
      });
      expect(res.periodEnd?.getTime()).toBe(ANCHOR.getTime() + 30 * 86_400_000);
    });
  });

  describe("Branch B - offboarding (removal leaves zero active modules)", () => {
    it("offers only keep + refund (NO credit) when removing the last module", () => {
      const now = new Date(ANCHOR.getTime() + 1_000);
      const res = getCancellationOptions({
        activeModules: ["books"],
        moduleKey: "books",
        interval: "monthly",
        anchorBillingDate: ANCHOR,
        now,
      });
      expect(res.branch).toBe("offboarding");
      const opts = res.options.map((o) => o.option);
      expect(opts).toEqual(["keep_until_end_of_cycle", "immediate_refund"]);
      expect(opts).not.toContain("immediate_credit");
    });

    it("recommends immediate_refund in Branch B", () => {
      const now = new Date(ANCHOR.getTime() + 1_000);
      const res = getCancellationOptions({
        activeModules: ["books"],
        moduleKey: "books",
        interval: "monthly",
        anchorBillingDate: ANCHOR,
        now,
      });
      expect(res.options.find((o) => o.option === "immediate_refund")?.recommended).toBe(true);
      expect(res.options.find((o) => o.option === "keep_until_end_of_cycle")?.recommended).toBe(
        false,
      );
    });

    it("cancel-all (no moduleKey) is always offboarding with summed refund", () => {
      // Books anchor (standalone 900) + Invoices addon (350) at ~full period = 1250.
      const now = new Date(ANCHOR.getTime() + 1_000);
      const res = getCancellationOptions({
        activeModules: ["books", "invoices"],
        moduleKey: undefined,
        interval: "monthly",
        anchorBillingDate: ANCHOR,
        now,
      });
      expect(res.branch).toBe("offboarding");
      expect(res.options.map((o) => o.option)).toEqual([
        "keep_until_end_of_cycle",
        "immediate_refund",
      ]);
      const refund = res.options.find((o) => o.option === "immediate_refund");
      // 900 (books standalone) + 350 (invoices addon) at ~full remaining = 1250.
      expect(refund?.amountCents).toBe(1250);
    });
  });

  describe("no active billing fallback", () => {
    it("offers only keep (amount 0) when interval is null", () => {
      const now = new Date();
      const res = getCancellationOptions({
        activeModules: ["books"],
        moduleKey: "books",
        interval: null,
        anchorBillingDate: ANCHOR,
        now,
      });
      expect(res.periodEnd).toBeNull();
      expect(res.options).toEqual([
        { option: "keep_until_end_of_cycle", amountCents: 0, recommended: true },
      ]);
    });

    it("offers only keep when anchorBillingDate is null", () => {
      const now = new Date();
      const res = getCancellationOptions({
        activeModules: ["books", "invoices"],
        moduleKey: "invoices",
        interval: "monthly",
        anchorBillingDate: null,
        now,
      });
      expect(res.options).toHaveLength(1);
      expect(res.options[0]?.option).toBe("keep_until_end_of_cycle");
      expect(res.options[0]?.amountCents).toBe(0);
    });

    it("no-billing single-module removal is still classified offboarding", () => {
      const now = new Date();
      const res = getCancellationOptions({
        activeModules: ["books"],
        moduleKey: "books",
        interval: null,
        anchorBillingDate: null,
        now,
      });
      // leavesZero → offboarding, but only keep offered (no billing).
      expect(res.branch).toBe("offboarding");
      expect(res.options).toHaveLength(1);
    });
  });

  describe("branch boundary", () => {
    it("two-module removal of one is continuous", () => {
      const now = new Date(ANCHOR.getTime() + 1_000);
      const res = getCancellationOptions({
        activeModules: ["books", "invoices"],
        moduleKey: "invoices",
        interval: "monthly",
        anchorBillingDate: ANCHOR,
        now,
      });
      expect(res.branch).toBe("continuous");
    });

    it("three-module removal of one is continuous", () => {
      const now = new Date(ANCHOR.getTime() + 1_000);
      const res = getCancellationOptions({
        activeModules: ["books", "drive", "invoices"],
        moduleKey: "drive",
        interval: "annual",
        anchorBillingDate: ANCHOR,
        now,
      });
      expect(res.branch).toBe("continuous");
    });
  });

  describe("option type coverage", () => {
    it("every Branch A option is a valid CancelOption", () => {
      const now = new Date(ANCHOR.getTime() + 1_000);
      const res = getCancellationOptions({
        activeModules: ["books", "invoices"],
        moduleKey: "invoices",
        interval: "monthly",
        anchorBillingDate: ANCHOR,
        now,
      });
      for (const o of res.options) {
        expect(["keep_until_end_of_cycle", "immediate_credit", "immediate_refund"]).toContain(
          o.option,
        );
      }
    });
  });
});

it("offers no Stripe credit or refund options for a store-managed subscription", () => {
  expect(
    getCancellationOptions({
      activeModules: ["books"],
      interval: "monthly",
      anchorBillingDate: ANCHOR,
      now: ANCHOR,
      provider: "apple",
    }).options,
  ).toEqual([]);
});
