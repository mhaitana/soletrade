import { describe, expect, it } from "vitest";
import {
  assistantApprovalFor,
  NEVER_AUTO_APPROVE,
  UNKNOWN_TOOL_REASON,
  UPDATE_APP_REASON,
} from "@/lib/assistant/approval-policy";
import { ASSISTANT_TOOLS } from "@/lib/assistant/tool-catalog";

const supported = { approvalsSupported: true };
const entries = Object.entries(ASSISTANT_TOOLS);

describe("assistantApprovalFor", () => {
  it("runs navigation, drafts and lookups without asking", () => {
    for (const [name, info] of entries) {
      if (info.kind === "write") continue;
      expect(assistantApprovalFor(name, supported), name).toEqual({ type: "not-applicable" });
    }
  });

  it("runs record and summary lookups without asking, on every app build", () => {
    // Named one by one: a lookup left out of the catalogue would be refused as unknown.
    for (const name of [
      "getInvoice",
      "getQuote",
      "getCustomer",
      "getTransaction",
      "getPeriodSummary",
      "getGstSummary",
      "listReceiptQueue",
    ]) {
      expect(assistantApprovalFor(name, supported), name).toEqual({ type: "not-applicable" });
      expect(assistantApprovalFor(name, { approvalsSupported: false }), name).toEqual({
        type: "not-applicable",
      });
      expect(NEVER_AUTO_APPROVE, name).not.toContain(name);
    }
  });

  it("asks the person before every change", () => {
    const writes = entries.filter(([, info]) => info.kind === "write");
    expect(writes.length).toBeGreaterThan(0);
    for (const [name] of writes) {
      expect(assistantApprovalFor(name, supported), name).toEqual({ type: "user-approval" });
    }
  });

  it("refuses a tool the catalogue does not know", () => {
    expect(assistantApprovalFor("wipeEverything", supported)).toEqual({
      type: "denied",
      reason: UNKNOWN_TOOL_REASON,
    });
    // Inherited object keys are not tools.
    expect(assistantApprovalFor("constructor", supported)).toMatchObject({ type: "denied" });
    expect(assistantApprovalFor("toString", supported)).toMatchObject({ type: "denied" });
  });

  it("refuses changes, but not lookups, for an app build without approval cards", () => {
    const old = { approvalsSupported: false };
    expect(assistantApprovalFor("createCustomer", old)).toEqual({
      type: "denied",
      reason: UPDATE_APP_REASON,
    });
    expect(assistantApprovalFor("listInvoices", old)).toEqual({ type: "not-applicable" });
  });

  it("lists only real write tools as never auto-approved", () => {
    for (const name of NEVER_AUTO_APPROVE) {
      expect(ASSISTANT_TOOLS[name]?.kind, name).toBe("write");
    }
  });
});
