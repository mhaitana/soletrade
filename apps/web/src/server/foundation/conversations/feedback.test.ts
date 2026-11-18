// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/server/infrastructure/db/types";
import { getDataClient } from "@/server/infrastructure/db/client";
import { branded } from "@/types/ids";
import {
  listConversationFeedback,
  setMessageFeedback,
} from "@/server/foundation/conversations/feedback";

vi.mock("@/server/infrastructure/db/client", () => ({ getDataClient: vi.fn() }));

/**
 * The real query builder runs; only the HTTP transport is replaced, so each test sees the
 * requests the database would receive.
 */

const WORKSPACE_ID = branded<"WorkspaceId">("00000000-0000-4000-8000-0000000000f1");
const USER_ID = branded<"UserId">("00000000-0000-4000-8000-0000000000f2");
const CONVERSATION_ID = branded<"AiConversationId">("00000000-0000-4000-8000-0000000000f3");
const MESSAGE_ID = "00000000-0000-4000-8000-0000000000f4";

type Recorded = { method: string; path: string; search: URLSearchParams; body: unknown };
const requests: Recorded[] = [];
/** What each table answers; a missing table answers with nothing found. */
let tables: Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requests.length = 0;
  tables = {
    ai_messages: {
      id: MESSAGE_ID,
      conversation_id: CONVERSATION_ID,
      role: "assistant",
      content: "Sales are up.",
    },
    ai_conversations: { id: CONVERSATION_ID },
  };
  vi.mocked(getDataClient).mockReturnValue(
    createClient<Database>("https://feedback.example.test", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const recorded: Recorded = {
            method: init?.method ?? "GET",
            path: url.pathname.replace("/rest/v1/", ""),
            search: url.searchParams,
            body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
          };
          requests.push(recorded);
          if (recorded.method !== "GET") return new Response(null, { status: 204 });
          const found = tables[recorded.path];
          return found === undefined ? json(null) : json(found);
        },
      },
    }),
  );
});

const writes = () => requests.filter((request) => request.method !== "GET");

describe("setMessageFeedback", () => {
  it("rates a reply only after confirming the conversation is this member's here", async () => {
    const result = await setMessageFeedback(WORKSPACE_ID, USER_ID, {
      messageId: MESSAGE_ID,
      rating: "down",
      comment: "  The total was wrong  ",
    });

    expect(result).toBe("saved");
    const ownership = requests.find((request) => request.path === "ai_conversations")!;
    expect(ownership.search.get("id")).toBe(`eq.${CONVERSATION_ID}`);
    expect(ownership.search.get("workspace_id")).toBe(`eq.${WORKSPACE_ID}`);
    expect(ownership.search.get("user_id")).toBe(`eq.${USER_ID}`);

    const [write] = writes();
    expect(write!.method).toBe("POST");
    expect(write!.path).toBe("ai_message_feedback");
    // One row per member per reply: a second rating replaces the first.
    expect(write!.search.get("on_conflict")).toBe("message_id,user_id");
    expect(write!.body).toMatchObject({
      workspace_id: WORKSPACE_ID,
      user_id: USER_ID,
      conversation_id: CONVERSATION_ID,
      message_id: MESSAGE_ID,
      rating: "down",
      comment: "The total was wrong",
      message_text: "Sales are up.",
    });
  });

  it("writes nothing for a reply in someone else's conversation", async () => {
    // The message exists, but the conversation is not this member's in this workspace.
    tables.ai_conversations = undefined;

    const result = await setMessageFeedback(WORKSPACE_ID, USER_ID, {
      messageId: MESSAGE_ID,
      rating: "up",
    });

    expect(result).toBe("not-found");
    expect(writes()).toEqual([]);
  });

  it("does not rate the person's own messages, or a message that is gone", async () => {
    tables.ai_messages = { ...(tables.ai_messages as object), role: "user" };
    expect(
      await setMessageFeedback(WORKSPACE_ID, USER_ID, { messageId: MESSAGE_ID, rating: "up" }),
    ).toBe("not-found");

    tables.ai_messages = undefined;
    expect(
      await setMessageFeedback(WORKSPACE_ID, USER_ID, { messageId: MESSAGE_ID, rating: "up" }),
    ).toBe("not-found");
    expect(writes()).toEqual([]);
  });

  it("clears only this member's rating on that reply", async () => {
    const result = await setMessageFeedback(WORKSPACE_ID, USER_ID, {
      messageId: MESSAGE_ID,
      rating: null,
    });

    expect(result).toBe("cleared");
    const [write] = writes();
    expect(write!.method).toBe("DELETE");
    expect(write!.search.get("message_id")).toBe(`eq.${MESSAGE_ID}`);
    expect(write!.search.get("user_id")).toBe(`eq.${USER_ID}`);
    expect(write!.search.get("workspace_id")).toBe(`eq.${WORKSPACE_ID}`);
  });

  it("keeps a long reply's text valid when the cut lands inside an emoji", async () => {
    // 3,999 letters then a two-unit emoji: a plain cut at 4,000 would keep half of it,
    // which the database rejects, so the rating could never be saved.
    tables.ai_messages = {
      ...(tables.ai_messages as object),
      content: `${"a".repeat(3999)}\u{1F9FE} and more`,
    };

    await setMessageFeedback(WORKSPACE_ID, USER_ID, { messageId: MESSAGE_ID, rating: "down" });

    const stored = (writes()[0]!.body as { message_text: string }).message_text;
    expect(stored).toBe("a".repeat(3999));
  });
});

describe("listConversationFeedback", () => {
  it("returns this member's ratings in the conversation, by message", async () => {
    tables.ai_message_feedback = [
      { message_id: MESSAGE_ID, rating: "up" },
      { message_id: "00000000-0000-4000-8000-0000000000f5", rating: "down" },
      // Not a rating the app knows: left out rather than passed on.
      { message_id: "00000000-0000-4000-8000-0000000000f6", rating: "maybe" },
    ];

    const ratings = await listConversationFeedback(WORKSPACE_ID, USER_ID, CONVERSATION_ID);

    expect(ratings).toEqual({
      [MESSAGE_ID]: "up",
      "00000000-0000-4000-8000-0000000000f5": "down",
    });
    const [read] = requests;
    expect(read!.search.get("workspace_id")).toBe(`eq.${WORKSPACE_ID}`);
    expect(read!.search.get("user_id")).toBe(`eq.${USER_ID}`);
    expect(read!.search.get("conversation_id")).toBe(`eq.${CONVERSATION_ID}`);
  });
});
