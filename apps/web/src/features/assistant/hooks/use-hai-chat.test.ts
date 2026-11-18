import { describe, expect, it, vi } from "vitest";
import {
  createHaiSession,
  haiRequestBody,
  readyToSendApprovals,
} from "@/features/assistant/hooks/use-hai-chat";
import type { HaiUIMessage } from "@/lib/assistant/messages";

const pageContext = { pathname: "/invoices", search: "?status=overdue" };

const user = (text: string): HaiUIMessage => ({
  id: "u1",
  role: "user",
  parts: [{ type: "text", text }],
});

function reply(...calls: Record<string, unknown>[]): HaiUIMessage {
  return {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "step-start" },
      ...calls.map((call, i) => ({
        type: "tool-createCustomer",
        toolCallId: `call-${i}`,
        input: { name: "Acme" },
        ...call,
      })),
    ],
  } as unknown as HaiUIMessage;
}

describe("haiRequestBody", () => {
  it("sends only the new message's text, never the transcript", () => {
    const body = haiRequestBody({
      conversationId: "c1",
      messages: [user("Earlier"), reply(), user("How are sales?")],
      trigger: "submit-message",
      pageContext,
    });
    expect(body).toEqual({
      conversationId: "c1",
      kind: "message",
      message: "How are sales?",
      pageContext,
    });
  });

  it("sends only the decisions after Approve or Decline", () => {
    const body = haiRequestBody({
      conversationId: "c1",
      messages: [
        user("Add Acme and Bolt"),
        reply(
          { state: "approval-responded", approval: { id: "ap-1", approved: true } },
          { state: "approval-responded", approval: { id: "ap-2", approved: false } },
          { state: "output-denied", approval: { id: "ap-3", approved: false } },
        ),
      ],
      trigger: "submit-message",
      pageContext,
    });
    // Tool names and inputs stay on the server.
    expect(body).toEqual({
      conversationId: "c1",
      kind: "approvals",
      approvals: [
        { approvalId: "ap-1", approved: true },
        { approvalId: "ap-2", approved: false },
      ],
    });
  });

  it("asks for a new answer to a named reply", () => {
    expect(
      haiRequestBody({
        conversationId: "c1",
        messages: [user("Hi")],
        trigger: "regenerate-message",
        messageId: "a1",
        pageContext,
      }),
    ).toEqual({ conversationId: "c1", kind: "regenerate", messageId: "a1" });
  });

  it("retries the person's last message after a failed request", () => {
    expect(
      haiRequestBody({
        conversationId: null,
        messages: [user("How are sales?")],
        trigger: "regenerate-message",
        pageContext,
      }),
    ).toEqual({ conversationId: null, kind: "retry", message: "How are sales?", pageContext });
  });
});

describe("readyToSendApprovals", () => {
  it("waits until every change in the latest step has a decision", () => {
    const partly = reply(
      { state: "approval-responded", approval: { id: "ap-1", approved: true } },
      { state: "approval-requested", approval: { id: "ap-2" } },
    );
    expect(readyToSendApprovals({ messages: [user("x"), partly] })).toBe(false);
  });

  it("sends once all are decided, counting server refusals as settled", () => {
    const decided = reply(
      { state: "approval-responded", approval: { id: "ap-1", approved: true } },
      { state: "output-denied", approval: { id: "ap-2", approved: false } },
    );
    expect(readyToSendApprovals({ messages: [user("x"), decided] })).toBe(true);
  });

  it("does not send when nothing was decided or the last message is the person's", () => {
    const finished = reply({ state: "output-available", output: { ok: true } });
    expect(readyToSendApprovals({ messages: [user("x"), finished] })).toBe(false);
    expect(readyToSendApprovals({ messages: [user("x")] })).toBe(false);
  });

  it("sends each decision once, even while the finished reply still shows it", async () => {
    const fetchMock = vi.fn<(url: unknown, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const session = createHaiSession("c1", () => {});
      const messages = [
        user("Add Acme"),
        reply({ state: "approval-responded", approval: { id: "ap-1", approved: false } }),
      ];
      expect(session.readyToSend({ messages })).toBe(true);
      await session.transport.sendMessages({
        chatId: "test",
        messages,
        trigger: "submit-message",
        messageId: undefined,
        abortSignal: undefined,
      });
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
        kind: "approvals",
        approvals: [{ approvalId: "ap-1", approved: false }],
      });
      // The SDK checks again after the reply ends; the same decision is not sent twice.
      expect(session.readyToSend({ messages })).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ignores decisions from an earlier step of the same reply", () => {
    const message = {
      ...reply({ state: "approval-responded", approval: { id: "ap-1", approved: true } }),
    };
    message.parts = [...message.parts, { type: "step-start" }, { type: "text", text: "Done." }];
    expect(readyToSendApprovals({ messages: [user("x"), message] })).toBe(false);
  });
});
