import { describe, expect, it } from "vitest";
import {
  actionPreviewFor,
  mapToolParts,
  messageMadeChanges,
  messageSummary,
  messageText,
  pendingApprovals,
  prepareModelHistory,
  storedToUIMessage,
  toolCallParts,
} from "@/lib/assistant/messages";

const preview = {
  type: "data-actionPreview",
  id: "call-1",
  data: {
    title: "Send invoice INV-7",
    details: ["To: Acme (ap@acme.test)", 42],
    consequence: "Emails the invoice.",
    caution: "sends-message",
  },
};

const proposal = {
  id: "a1",
  role: "assistant" as const,
  parts: [
    { type: "step-start" },
    {
      type: "tool-sendInvoice",
      toolCallId: "call-1",
      state: "approval-requested",
      input: { number: "INV-7" },
      approval: { id: "ap-1" },
    },
    preview,
  ],
};

describe("stored messages", () => {
  it("joins text parts and skips everything else", () => {
    expect(
      messageText([
        { type: "text", text: "One" },
        { type: "tool-listInvoices", toolCallId: "x", state: "output-available" },
        { type: "text", text: "  " },
        { type: "text", text: "Two" },
      ]),
    ).toBe("One\n\nTwo");
  });

  it("turns rows saved before parts existed into one text part", () => {
    expect(
      storedToUIMessage({ id: "m1", role: "assistant", content: "Hello", parts: null }),
    ).toEqual({ id: "m1", role: "assistant", parts: [{ type: "text", text: "Hello" }] });
    expect(
      storedToUIMessage({ id: "m1", role: "assistant", content: "Hello", parts: [] }).parts,
    ).toEqual([{ type: "text", text: "Hello" }]);
  });

  it("reads tool calls without trusting their shape", () => {
    const calls = toolCallParts({
      parts: [
        { type: "tool-createCustomer", toolCallId: "c1", state: "output-available" },
        {
          type: "dynamic-tool",
          toolName: "listQuotes",
          toolCallId: "c2",
          state: "input-available",
        },
        { type: "tool-broken", state: "output-available" },
        { type: "text", text: "hi" },
        null,
      ],
    });
    expect(calls.map((c) => [c.toolName, c.toolCallId])).toEqual([
      ["createCustomer", "c1"],
      ["listQuotes", "c2"],
    ]);
  });
});

describe("approvals", () => {
  it("reads the server's preview and drops malformed fields", () => {
    expect(actionPreviewFor(proposal, "call-1")).toEqual({
      title: "Send invoice INV-7",
      details: ["To: Acme (ap@acme.test)"],
      consequence: "Emails the invoice.",
      caution: "sends-message",
    });
    expect(actionPreviewFor(proposal, "other")).toBeNull();
  });

  it("lists changes still waiting, not automatic denials", () => {
    expect(pendingApprovals(proposal)).toEqual([
      {
        approvalId: "ap-1",
        toolCallId: "call-1",
        toolName: "sendInvoice",
        preview: expect.objectContaining({ title: "Send invoice INV-7" }),
      },
    ]);
    const automatic = mapToolParts(proposal, (part) => ({
      ...part,
      approval: { id: "ap-1", isAutomatic: true },
    }));
    expect(pendingApprovals(automatic)).toEqual([]);
  });

  it("summarises a reply that is only tool calls for older app builds", () => {
    expect(messageSummary(proposal)).toBe("Waiting for your approval: Send invoice INV-7.");
    const denied = mapToolParts(proposal, (part) => ({ ...part, state: "output-denied" }));
    expect(messageSummary(denied)).toBe("Not done: Send invoice INV-7.");
  });
});

describe("messageMadeChanges", () => {
  const ran = (toolName: string, output: unknown) => ({
    parts: [{ type: `tool-${toolName}`, toolCallId: "c", state: "output-available", output }],
  });

  it("is true only for a write that ran without an error", () => {
    expect(messageMadeChanges(ran("createCustomer", { ok: true }))).toBe(true);
    expect(messageMadeChanges(ran("createCustomer", { error: "No access." }))).toBe(false);
    expect(messageMadeChanges(ran("listInvoices", { items: [] }))).toBe(false);
    expect(messageMadeChanges(proposal)).toBe(false);
  });

  it("counts a tool missing from the catalogue as a change", () => {
    expect(messageMadeChanges(ran("somethingNew", {}))).toBe(true);
  });
});

describe("prepareModelHistory", () => {
  const user = { id: "u1", role: "user", parts: [{ type: "text", text: "Send INV-7" }] };

  it("drops previews and calls that are still waiting", () => {
    const prepared = prepareModelHistory([user, proposal], new Set(["sendInvoice"]));
    // Nothing left in the reply but a step marker, so it is dropped.
    expect(prepared).toEqual([user]);
  });

  it("keeps a decided call only in the message being continued", () => {
    const decided = mapToolParts(proposal, (part) => ({
      ...part,
      state: "approval-responded",
      approval: { id: "ap-1", approved: true },
    }));
    const tools = new Set(["sendInvoice"]);
    expect(prepareModelHistory([user, decided], tools).at(-1)?.parts).toHaveLength(2);
    expect(prepareModelHistory([user, decided, user], tools)).toEqual([user, user]);
  });

  it("turns a finished call to a tool no longer offered into a note", () => {
    const done = {
      id: "a2",
      role: "assistant",
      parts: [
        {
          type: "tool-createCustomer",
          toolCallId: "c1",
          state: "output-available",
          output: { ok: true, recordLabel: "Acme" },
        },
      ],
    };
    const prepared = prepareModelHistory([user, done], new Set(["listInvoices"]));
    expect(prepared.at(-1)?.parts).toEqual([
      { type: "text", text: expect.stringContaining("Acme") },
    ]);
  });
});
