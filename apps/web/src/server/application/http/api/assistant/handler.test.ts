// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRateLimits } from "@/server/infrastructure/rate-limit/index";
import { UNKNOWN_TOOL_REASON, UPDATE_APP_REASON } from "@/lib/assistant/approval-policy";
import {
  executed,
  ledgerRows,
  modelPrompts,
  readChunks,
  resetAssistantHarness,
  scriptModel,
  seedConversation,
  storedMessages,
  tamperLedgerInput,
  testContext,
  type StreamChunk,
} from "@/testing/assistant-harness";

/**
 * The hAI route end to end with a scripted model: what the model asks for, what waits for
 * approval, what runs (and how often), and what is stored. The conversation store and the
 * action ledger are in memory but keep the real rules (owner scope, conditional updates).
 */

const mocks = vi.hoisted(() => ({
  tryWorkspaceContext: vi.fn(),
  requireMobileContext: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/application/auth/workspace-context", () => ({
  tryWorkspaceContext: mocks.tryWorkspaceContext,
}));
vi.mock("@/server/application/mobile/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/application/mobile/http")>()),
  requireMobileContext: mocks.requireMobileContext,
}));
vi.mock("@/server/foundation/conversations/conversations", async () => {
  const harness = await import("@/testing/assistant-harness");
  return harness.fakeConversations;
});
vi.mock("@/server/foundation/conversations/tool-actions", async () => {
  const harness = await import("@/testing/assistant-harness");
  return harness.fakeToolActions;
});
vi.mock("@/server/foundation/ai-usage/usage", async () => {
  const harness = await import("@/testing/assistant-harness");
  return harness.fakeAiUsage;
});
vi.mock("@/server/foundation/module-installations/index", () => ({
  getInstalledModules: async () => ["invoices", "customers"],
}));
vi.mock("@/server/foundation/workspaces/index", () => ({
  getWorkspace: async () => ({
    name: "Test Plumbing",
    defaultCurrency: "AUD",
    timezone: "Australia/Sydney",
    fyStartMonth: 7,
  }),
}));
vi.mock("@/server/infrastructure/ai/provider", async () => {
  const harness = await import("@/testing/assistant-harness");
  return { getAIModel: () => harness.scriptedModel, isMockProvider: () => false };
});
vi.mock("@/server/application/assistant/tools", async () => {
  const harness = await import("@/testing/assistant-harness");
  return {
    buildAssistantTools: harness.buildTestTools,
    buildMockAssistantReply: async () => "",
    buildMockHaiSafeAction: () => null,
  };
});
vi.mock("@/server/application/assistant/action-preview", async () => {
  const harness = await import("@/testing/assistant-harness");
  return { buildActionPreview: harness.buildTestPreview };
});

import { POST } from "@/server/application/http/api/assistant/handler";

function post(body: Record<string, unknown>, init: { app?: boolean; capabilities?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.app) headers.set("authorization", "Bearer test-token");
  if (init.capabilities) headers.set("x-hai-capabilities", init.capabilities);
  return POST(
    new Request("https://app.example.test/api/assistant", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

async function turn(
  body: Record<string, unknown>,
  init?: { app?: boolean; capabilities?: string },
) {
  const response = await post(body, init);
  expect(response.status).toBe(200);
  return readChunks(response);
}

/** Approvals the person is asked for (the SDK also reports automatic denials this way). */
const approvalRequests = (chunks: StreamChunk[]) =>
  chunks.filter(
    (c) => c.type === "tool-approval-request" && c.isAutomatic !== true,
  ) as (StreamChunk & {
    approvalId: string;
    toolCallId: string;
  })[];

function lastParts(conversationId: string): Record<string, unknown>[] {
  const messages = storedMessages(conversationId);
  return (messages.at(-1)?.parts ?? []) as Record<string, unknown>[];
}

function toolPart(conversationId: string, toolCallId: string): Record<string, unknown> | undefined {
  return lastParts(conversationId).find((part) => part.toolCallId === toolCallId);
}

/** Ask for a customer to be added; returns the pending approval. */
async function proposeCustomer(conversationId: string) {
  scriptModel({ toolCalls: [{ id: "call-1", name: "createCustomer", input: { name: "Acme" } }] });
  const chunks = await turn({ conversationId, message: "Add Acme as a customer" });
  const [request] = approvalRequests(chunks);
  expect(request?.toolCallId).toBe("call-1");
  return { chunks, approvalId: request!.approvalId };
}

beforeEach(() => {
  resetAssistantHarness();
  clearRateLimits();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  mocks.tryWorkspaceContext.mockResolvedValue(testContext);
  mocks.requireMobileContext.mockResolvedValue(testContext);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/assistant: requests", () => {
  it("returns 401 without a workspace session", async () => {
    mocks.tryWorkspaceContext.mockResolvedValue(null);
    expect((await post({ message: "hi" })).status).toBe(401);
  });

  it("rejects an empty message", async () => {
    expect((await post({ message: "   " })).status).toBe(400);
  });

  it("does not open another member's conversation", async () => {
    const other = seedConversation({ userId: "00000000-0000-4000-8000-00000000b002" });
    expect((await post({ conversationId: other, message: "hi" })).status).toBe(404);
  });

  it("creates a conversation on the first message and stores the whole reply", async () => {
    scriptModel({ text: "Hello! How can I help?" });
    const response = await post({ message: "Hi there" });
    const id = response.headers.get("X-Conversation-Id");
    expect(id).toBeTruthy();
    await readChunks(response);
    const messages = storedMessages(id!);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "Hi there"],
      ["assistant", "Hello! How can I help?"],
    ]);
    expect(messages[1]!.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", text: "Hello! How can I help?" }),
      ]),
    );
  });
});

describe("POST /api/assistant: changes wait for approval", () => {
  it("pauses a change with the server's preview and runs nothing", async () => {
    const id = seedConversation({ writeEnabled: true });
    const { chunks } = await proposeCustomer(id);
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "data-actionPreview",
        id: "call-1",
        data: expect.objectContaining({ title: "Preview of createCustomer" }),
      }),
    );
    expect(executed.createCustomer).toEqual([]);
    expect(ledgerRows()).toEqual([
      expect.objectContaining({
        toolCallId: "call-1",
        toolName: "createCustomer",
        status: "pending",
      }),
    ]);
    expect(toolPart(id, "call-1")).toMatchObject({ state: "approval-requested" });
    expect(storedMessages(id).at(-1)!.content).toBe(
      "Waiting for your approval: Preview of createCustomer.",
    );
  });

  it("runs an approved change once and continues the same reply", async () => {
    const id = seedConversation({ writeEnabled: true });
    const { approvalId } = await proposeCustomer(id);
    const replyId = storedMessages(id).at(-1)!.id;

    scriptModel({ text: "Added Acme." });
    const chunks = await turn({
      conversationId: id,
      kind: "approvals",
      approvals: [{ approvalId, approved: true }],
    });
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: "tool-output-available", toolCallId: "call-1" }),
    );
    expect(executed.createCustomer).toEqual([{ name: "Acme" }]);
    expect(ledgerRows()[0]).toMatchObject({ status: "succeeded" });
    // One stored reply, continued in place.
    expect(storedMessages(id)).toHaveLength(2);
    expect(storedMessages(id).at(-1)!.id).toBe(replyId);
    expect(toolPart(id, "call-1")).toMatchObject({ state: "output-available" });

    // Sending the same approval again finds nothing waiting and runs nothing.
    const again = await post({
      conversationId: id,
      kind: "approvals",
      approvals: [{ approvalId, approved: true }],
    });
    expect(again.status).toBe(409);
    expect(executed.createCustomer).toHaveLength(1);
  });

  it("runs a change once when the same approval arrives twice at the same time", async () => {
    const id = seedConversation({ writeEnabled: true });
    const { approvalId } = await proposeCustomer(id);
    scriptModel({ text: "Added Acme." }, { text: "Added Acme." });
    const body = {
      conversationId: id,
      kind: "approvals",
      approvals: [{ approvalId, approved: true }],
    };
    const responses = await Promise.all([post(body), post(body)]);
    await Promise.all(responses.map((r) => r.text()));
    expect(executed.createCustomer).toHaveLength(1);
    expect(ledgerRows()[0]).toMatchObject({ status: "succeeded" });
  });

  it("runs nothing when the change is declined", async () => {
    const id = seedConversation({ writeEnabled: true });
    const { approvalId } = await proposeCustomer(id);
    scriptModel({ text: "OK, I won't add it." });
    await turn({
      conversationId: id,
      kind: "approvals",
      approvals: [{ approvalId, approved: false }],
    });
    expect(executed.createCustomer).toEqual([]);
    expect(ledgerRows()[0]).toMatchObject({ status: "denied" });
    expect(toolPart(id, "call-1")).toMatchObject({ state: "output-denied" });

    // A later turn still tells the model the change was declined.
    scriptModel({ text: "Anything else?" });
    await turn({ conversationId: id, message: "Thanks" });
    const prompt = JSON.stringify(modelPrompts.at(-1));
    expect(prompt).toContain('"toolCallId":"call-1"');
    expect(prompt).toContain("execution denied");
  });

  it("needs a decision on every change that is waiting", async () => {
    const id = seedConversation({ writeEnabled: true });
    scriptModel({
      toolCalls: [
        { id: "call-a", name: "createCustomer", input: { name: "Acme" } },
        { id: "call-b", name: "createCustomer", input: { name: "Bolt" } },
      ],
    });
    const requests = approvalRequests(await turn({ conversationId: id, message: "Add both" }));
    expect(requests).toHaveLength(2);
    const partial = await post({
      conversationId: id,
      kind: "approvals",
      approvals: [{ approvalId: requests[0]!.approvalId, approved: true }],
    });
    expect(partial.status).toBe(400);
    expect(executed.createCustomer).toEqual([]);
  });

  it("does not run a change whose stored proposal no longer matches the model's call", async () => {
    const id = seedConversation({ writeEnabled: true });
    const { approvalId } = await proposeCustomer(id);
    tamperLedgerInput("call-1", { name: "Someone else" });
    scriptModel({ text: "That change was not run." });
    await turn({
      conversationId: id,
      kind: "approvals",
      approvals: [{ approvalId, approved: true }],
    });
    expect(executed.createCustomer).toEqual([]);
  });

  it("declines open changes when the person sends a new message instead", async () => {
    const id = seedConversation({ writeEnabled: true });
    const { approvalId } = await proposeCustomer(id);
    const proposalId = storedMessages(id).at(-1)!.id;
    scriptModel({ text: "Sure, forget it." });
    await turn({ conversationId: id, message: "Actually, never mind" });

    const proposal = storedMessages(id).find((m) => m.id === proposalId)!;
    expect(
      (proposal.parts as Record<string, unknown>[]).find((p) => p.toolCallId === "call-1"),
    ).toMatchObject({ state: "output-denied" });
    expect(ledgerRows()[0]).toMatchObject({ status: "denied" });
    const late = await post({
      conversationId: id,
      kind: "approvals",
      approvals: [{ approvalId, approved: true }],
    });
    expect(late.status).toBe(409);
    expect(executed.createCustomer).toEqual([]);
  });

  it("refuses a tool the catalogue does not know, without running it", async () => {
    const id = seedConversation({ writeEnabled: true });
    scriptModel(
      { toolCalls: [{ id: "call-x", name: "wipeEverything", input: {} }] },
      { text: "I can't do that." },
    );
    const chunks = await turn({ conversationId: id, message: "Delete everything" });
    expect(approvalRequests(chunks)).toEqual([]);
    expect(executed.wipeEverything).toBe(0);
    expect(JSON.stringify(storedMessages(id).at(-1)!.parts)).toContain(UNKNOWN_TOOL_REASON);
  });
});

describe("POST /api/assistant: the mobile app", () => {
  it("refuses changes for an app build that cannot show approval cards", async () => {
    const id = seedConversation({ writeEnabled: true });
    scriptModel(
      { toolCalls: [{ id: "call-1", name: "createCustomer", input: { name: "Acme" } }] },
      { text: "Please update the app." },
    );
    const chunks = await turn({ conversationId: id, message: "Add Acme" }, { app: true });
    expect(approvalRequests(chunks)).toEqual([]);
    expect(executed.createCustomer).toEqual([]);
    expect(JSON.stringify(storedMessages(id).at(-1)!.parts)).toContain(UPDATE_APP_REASON);
  });

  it("asks an app build that can show approval cards", async () => {
    const id = seedConversation({ writeEnabled: true });
    scriptModel({ toolCalls: [{ id: "call-1", name: "createCustomer", input: { name: "Acme" } }] });
    const chunks = await turn(
      { conversationId: id, message: "Add Acme" },
      { app: true, capabilities: "approvals" },
    );
    expect(approvalRequests(chunks)).toHaveLength(1);
  });
});

describe("POST /api/assistant: regenerate and retry", () => {
  it("answers again in place of a reply that changed nothing", async () => {
    const id = seedConversation({ writeEnabled: true });
    await proposeCustomer(id);
    const oldReply = storedMessages(id).at(-1)!.id;
    scriptModel({ text: "Here is another answer." });
    await turn({ conversationId: id, kind: "regenerate", messageId: oldReply });
    const messages = storedMessages(id);
    expect(messages).toHaveLength(2);
    expect(messages.at(-1)!.id).not.toBe(oldReply);
    expect(messages.at(-1)!.content).toBe("Here is another answer.");
    expect(ledgerRows()[0]).toMatchObject({ status: "denied" });
  });

  it("refuses to answer again when the reply made changes", async () => {
    const id = seedConversation({ writeEnabled: true });
    const { approvalId } = await proposeCustomer(id);
    scriptModel({ text: "Added Acme." });
    await turn({
      conversationId: id,
      kind: "approvals",
      approvals: [{ approvalId, approved: true }],
    });
    const reply = storedMessages(id).at(-1)!.id;
    const response = await post({ conversationId: id, kind: "regenerate", messageId: reply });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "reply_made_changes" });
  });

  it("answers a stored message on retry without storing it twice", async () => {
    const id = seedConversation({ messages: [{ role: "user", content: "How are sales?" }] });
    scriptModel({ text: "Sales are up." });
    await turn({ conversationId: id, kind: "retry", message: "How are sales?" });
    expect(storedMessages(id).map((m) => [m.role, m.content])).toEqual([
      ["user", "How are sales?"],
      ["assistant", "Sales are up."],
    ]);
  });

  it("sends the message on retry when it never arrived", async () => {
    const id = seedConversation({
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello." },
      ],
    });
    scriptModel({ text: "Sales are up." });
    await turn({ conversationId: id, kind: "retry", message: "How are sales?" });
    expect(storedMessages(id).map((m) => m.content)).toEqual([
      "Hi",
      "Hello.",
      "How are sales?",
      "Sales are up.",
    ]);
  });
});
