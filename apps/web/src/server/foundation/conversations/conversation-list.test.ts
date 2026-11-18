// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/server/infrastructure/db/types";
import { getDataClient } from "@/server/infrastructure/db/client";
import { branded } from "@/types/ids";
import {
  CONVERSATION_PAGE_SIZE,
  listConversationPage,
  listConversations,
} from "@/server/foundation/conversations/conversations";

vi.mock("@/server/infrastructure/db/client", () => ({ getDataClient: vi.fn() }));

/**
 * The real query builder runs; only the HTTP transport is replaced, so each test sees the
 * request the database would receive.
 */

const WORKSPACE_ID = branded<"WorkspaceId">("00000000-0000-4000-8000-0000000000a1");
const USER_ID = branded<"UserId">("00000000-0000-4000-8000-0000000000a2");

type Recorded = { search: URLSearchParams; range: string | null };
const requests: Recorded[] = [];
let rows: { id: string; title: string; updated_at: string }[];

const row = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  title: `Conversation ${n}`,
  updated_at: "2026-11-18T09:00:00",
});

beforeEach(() => {
  vi.clearAllMocks();
  requests.length = 0;
  rows = [];
  vi.mocked(getDataClient).mockReturnValue(
    createClient<Database>("https://conversations.example.test", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const headers = new Headers(init?.headers);
          requests.push({ search: url.searchParams, range: headers.get("range") });
          // Answer like the database would: only the rows inside the requested window.
          const offset = Number(url.searchParams.get("offset") ?? 0);
          const limit = Number(url.searchParams.get("limit") ?? rows.length);
          return new Response(JSON.stringify(rows.slice(offset, offset + limit)), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    }),
  );
});

describe("listConversations", () => {
  it("reads only this member's conversations in this workspace, newest first", async () => {
    await listConversations(WORKSPACE_ID, USER_ID);

    const { search } = requests[0]!;
    expect(search.get("workspace_id")).toBe(`eq.${WORKSPACE_ID}`);
    expect(search.get("user_id")).toBe(`eq.${USER_ID}`);
    // The id breaks ties, so paging never repeats or skips a row.
    expect(search.get("order")).toBe("updated_at.desc,id.desc");
    expect(search.get("title")).toBeNull();
  });

  it("searches titles for the text as typed, not as a pattern", async () => {
    await listConversations(WORKSPACE_ID, USER_ID, { search: "  100%_done\\ 5*3  " });

    // % _ and \ are escaped; * has no escape in PostgREST, so it matches any one character.
    expect(requests[0]!.search.get("title")).toBe("ilike.%100\\%\\_done\\\\ 5_3%");
  });

  it("does not filter on an empty search", async () => {
    await listConversations(WORKSPACE_ID, USER_ID, { search: "   " });
    expect(requests[0]!.search.get("title")).toBeNull();
  });
});

describe("listConversationPage", () => {
  it("returns one page and says more follow when a further row exists", async () => {
    rows = Array.from({ length: CONVERSATION_PAGE_SIZE + 5 }, (_, i) => row(i + 1));

    const first = await listConversationPage(WORKSPACE_ID, USER_ID);

    expect(first.conversations).toHaveLength(CONVERSATION_PAGE_SIZE);
    expect(first.hasMore).toBe(true);
    // It asks for one row beyond the page, starting at the top.
    expect(requests[0]!.search.get("offset")).toBe("0");
    expect(requests[0]!.search.get("limit")).toBe(String(CONVERSATION_PAGE_SIZE + 1));

    const second = await listConversationPage(WORKSPACE_ID, USER_ID, {
      offset: CONVERSATION_PAGE_SIZE,
    });
    expect(second.conversations.map((c) => c.title)).toEqual(
      rows.slice(CONVERSATION_PAGE_SIZE).map((r) => r.title),
    );
    expect(second.hasMore).toBe(false);
  });

  it("says nothing more follows a page that is exactly full", async () => {
    rows = Array.from({ length: CONVERSATION_PAGE_SIZE }, (_, i) => row(i + 1));

    const page = await listConversationPage(WORKSPACE_ID, USER_ID);

    expect(page.conversations).toHaveLength(CONVERSATION_PAGE_SIZE);
    expect(page.hasMore).toBe(false);
  });
});
