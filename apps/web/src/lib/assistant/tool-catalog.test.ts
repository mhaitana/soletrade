// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_TOOLS,
  assistantToolInfo,
  readToolCardFields,
} from "@/lib/assistant/tool-catalog";

describe("assistant tool catalogue", () => {
  it("treats a tool it does not know as a write, never as a harmless read", () => {
    expect(assistantToolInfo("somethingNewAndUnlisted").kind).toBe("write");
  });

  it("classifies navigation, lookups and changes", () => {
    expect(assistantToolInfo("openForm").kind).toBe("navigate");
    expect(assistantToolInfo("listInvoices").kind).toBe("read");
    expect(assistantToolInfo("sendInvoice")).toMatchObject({
      kind: "write",
      target: "invoice",
      caution: "sends-message",
    });
    expect(assistantToolInfo("deleteTransaction").caution).toBe("cannot-undo");
  });

  it("classifies record and summary lookups as reads, with a label for the chat card", () => {
    const lookups = {
      getInvoice: "an invoice",
      getQuote: "a quote",
      getCustomer: "a customer",
      getTransaction: "a transaction",
      getPeriodSummary: "the profit and loss",
      getGstSummary: "the GST position",
      listReceiptQueue: "receipts",
    };
    for (const [name, noun] of Object.entries(lookups)) {
      // `hasOwn`, because an unlisted name would fall back to the write entry.
      expect(Object.hasOwn(ASSISTANT_TOOLS, name), name).toBe(true);
      expect(assistantToolInfo(name), name).toEqual({
        kind: "read",
        running: `Looking up ${noun}`,
        done: `Looked up ${noun}`,
      });
    }
  });

  it("gives every write tool an audit target", () => {
    for (const [name, info] of Object.entries(ASSISTANT_TOOLS)) {
      if (info.kind === "write") expect(info.target, name).toBeTruthy();
    }
  });
});

describe("readToolCardFields", () => {
  it("reads list and record fields", () => {
    expect(
      readToolCardFields({ items: [], returned: 20, hasMore: true, href: "/invoices" }),
    ).toEqual({
      returned: 20,
      hasMore: true,
      href: "/invoices",
    });
    expect(
      readToolCardFields({ id: "1", href: "/invoices/1", recordLabel: "INV-2026-0007" }),
    ).toEqual({ href: "/invoices/1", recordLabel: "INV-2026-0007" });
  });

  it("reports a tool's own error", () => {
    expect(readToolCardFields({ error: "Invoice INV-9 not found." })).toEqual({
      error: "Invoice INV-9 not found.",
    });
  });

  it("only accepts in-app links", () => {
    expect(readToolCardFields({ href: "https://evil.example/x" })).toEqual({});
    expect(readToolCardFields({ href: "//evil.example/x" })).toEqual({});
    expect(readToolCardFields({ href: "javascript:alert(1)" })).toEqual({});
  });

  it("ignores output that is not a plain object or has the wrong field types", () => {
    expect(readToolCardFields(null)).toEqual({});
    expect(readToolCardFields([{ id: 1 }])).toEqual({});
    expect(readToolCardFields("text")).toEqual({});
    expect(readToolCardFields({ returned: "20", hasMore: "yes", recordLabel: 5 })).toEqual({});
  });
});
