import { approvalBatch, approvalTitle, type PendingApproval } from "./approvals";

const pending: PendingApproval[] = [
  {
    approvalId: "ap-1",
    toolCallId: "call-1",
    toolName: "sendInvoice",
    preview: { title: "Send invoice INV-7", details: ["To: Acme"] },
  },
  { approvalId: "ap-2", toolCallId: "call-2", toolName: "createCustomer", preview: null },
];

describe("approvalTitle", () => {
  it("uses the server's preview, with a fallback when there is none", () => {
    expect(approvalTitle(pending[0]!)).toBe("Send invoice INV-7");
    expect(approvalTitle(pending[1]!)).toBe("Run createCustomer");
  });
});

describe("approvalBatch", () => {
  it("waits until every change has a decision", () => {
    expect(approvalBatch(pending, {})).toBeNull();
    expect(approvalBatch(pending, { "ap-1": true })).toBeNull();
  });

  it("sends only approval ids and decisions, in order", () => {
    expect(approvalBatch(pending, { "ap-2": false, "ap-1": true })).toEqual({
      approvals: [
        { approvalId: "ap-1", approved: true },
        { approvalId: "ap-2", approved: false },
      ],
    });
  });

  it("ignores decisions for changes that are no longer waiting", () => {
    expect(approvalBatch(pending.slice(0, 1), { "ap-1": false, stale: true })).toEqual({
      approvals: [{ approvalId: "ap-1", approved: false }],
    });
  });

  it("has nothing to send when nothing is waiting", () => {
    expect(approvalBatch([], { "ap-1": true })).toBeNull();
  });
});
