// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/server/infrastructure/db/types";
import { getDataClient } from "@/server/infrastructure/db/client";
import { branded } from "@/types/ids";
import {
  renameConversation,
  replaceConversationTitle,
} from "@/server/foundation/conversations/conversations";

vi.mock("@/server/infrastructure/db/client", () => ({ getDataClient: vi.fn() }));

/**
 * Replacing an automatic title with a generated one. The real query builder runs; only
 * the HTTP transport is replaced, so each test sees the request the database would
 * receive: which rows it may touch and which columns it writes.
 */

const WORKSPACE_ID = branded<"WorkspaceId">("00000000-0000-4000-8000-0000000000a1");
const USER_ID = branded<"UserId">("00000000-0000-4000-8000-0000000000a2");
const CONVERSATION_ID = branded<"AiConversationId">("00000000-0000-4000-8000-0000000000a3");

type Recorded = {
  method: string;
  path: string;
  search: URLSearchParams;
  body: Record<string, unknown> | null;
  prefer: string | null;
};
const requests: Recorded[] = [];
/** The rows the database says it updated. */
let updated: { id: string }[];

beforeEach(() => {
  vi.clearAllMocks();
  requests.length = 0;
  updated = [{ id: CONVERSATION_ID }];
  vi.mocked(getDataClient).mockReturnValue(
    createClient<Database>("https://conversations.example.test", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const headers = new Headers(init?.headers);
          requests.push({
            method: init?.method ?? "GET",
            path: url.pathname,
            search: url.searchParams,
            body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
            prefer: headers.get("prefer"),
          });
          return new Response(JSON.stringify(updated), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    }),
  );
});

describe("replaceConversationTitle", () => {
  const change = { from: "How much am I owed by customers who are …", to: "Overdue balances" };

  it("updates only the row that still has the expected title", async () => {
    await replaceConversationTitle(WORKSPACE_ID, USER_ID, CONVERSATION_ID, change);

    expect(requests).toHaveLength(1);
    const { method, path, search } = requests[0]!;
    expect(method).toBe("PATCH");
    expect(path).toBe("/rest/v1/ai_conversations");
    // This member's conversation in this workspace...
    expect(search.get("id")).toBe(`eq.${CONVERSATION_ID}`);
    expect(search.get("workspace_id")).toBe(`eq.${WORKSPACE_ID}`);
    expect(search.get("user_id")).toBe(`eq.${USER_ID}`);
    // ...and only while its title is still exactly the one that was seen: the condition
    // is part of the update itself, so a rename in between leaves nothing to match.
    expect(search.get("title")).toBe(`eq.${change.from}`);
  });

  it("writes the title and nothing else, so the conversation's version does not move", async () => {
    await replaceConversationTitle(WORKSPACE_ID, USER_ID, CONVERSATION_ID, change);
    // The mobile app sends `updatedAt` as the version it expects with its next request.
    expect(requests[0]!.body).toEqual({ title: "Overdue balances" });
    expect(requests[0]!.body).not.toHaveProperty("updated_at");

    // A rename by the person is a different thing: it does move the conversation up.
    await renameConversation(WORKSPACE_ID, USER_ID, CONVERSATION_ID, "My name");
    expect(requests[1]!.body).toHaveProperty("updated_at");
    expect(requests[1]!.search.get("title")).toBeNull();
  });

  it("says whether the title was replaced", async () => {
    // It asks for the updated rows back, which is how it knows.
    expect(await replaceConversationTitle(WORKSPACE_ID, USER_ID, CONVERSATION_ID, change)).toBe(
      true,
    );
    expect(requests[0]!.prefer).toContain("return=representation");
    expect(requests[0]!.search.get("select")).toBe("id");

    // The person renamed it first: no row matched, nothing was changed.
    updated = [];
    expect(await replaceConversationTitle(WORKSPACE_ID, USER_ID, CONVERSATION_ID, change)).toBe(
      false,
    );
  });

  it("matches a title with punctuation in it literally", async () => {
    const from = 'Invoices for "Acme, Inc." (overdue)';
    await replaceConversationTitle(WORKSPACE_ID, USER_ID, CONVERSATION_ID, { from, to: "Acme" });
    expect(requests[0]!.search.get("title")).toBe(`eq.${from}`);
  });
});
