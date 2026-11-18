// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/server/infrastructure/db/types";
import { getDataClient } from "@/server/infrastructure/db/client";
import { branded } from "@/types/ids";
import {
  claimDueDigests,
  getDigestFrequency,
  releaseDigestClaim,
  setDigestFrequency,
  type DigestClaim,
} from "@/server/foundation/notifications/digest-preferences";

vi.mock("@/server/infrastructure/db/client", () => ({ getDataClient: vi.fn() }));

/**
 * The real query builder runs; only the HTTP transport is replaced, so each test sees the
 * request the database would receive.
 */

const WORKSPACE_ID = branded<"WorkspaceId">("00000000-0000-4000-8000-0000000000d1");
const USER_ID = branded<"UserId">("00000000-0000-4000-8000-0000000000d2");

type Recorded = {
  method: string;
  path: string;
  search: URLSearchParams;
  body: unknown;
  prefer: string | null;
};
const requests: Recorded[] = [];
let respond: (request: Recorded) => Response;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requests.length = 0;
  respond = () => json([]);
  vi.mocked(getDataClient).mockReturnValue(
    createClient<Database>("https://digest-preferences.example.test", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const recorded: Recorded = {
            method: init?.method ?? "GET",
            path: url.pathname.replace("/rest/v1/", ""),
            search: url.searchParams,
            body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
            prefer: new Headers(init?.headers).get("prefer"),
          };
          requests.push(recorded);
          return respond(recorded);
        },
      },
    }),
  );
});

describe("getDigestFrequency", () => {
  it("reads the member's own row in the given workspace", async () => {
    respond = () => json({ frequency: "weekly" });
    expect(await getDigestFrequency(WORKSPACE_ID, USER_ID)).toBe("weekly");

    expect(requests).toHaveLength(1);
    expect(requests[0]!.path).toBe("ai_digest_preferences");
    expect(requests[0]!.search.get("workspace_id")).toBe(`eq.${WORKSPACE_ID}`);
    expect(requests[0]!.search.get("user_id")).toBe(`eq.${USER_ID}`);
  });

  it("is off for a member who has never chosen", async () => {
    respond = () => json(null);
    expect(await getDigestFrequency(WORKSPACE_ID, USER_ID)).toBe("off");
  });

  it("does not present a failed read as off", async () => {
    respond = () => json({ code: "42P01", message: "relation does not exist" }, 404);
    await expect(getDigestFrequency(WORKSPACE_ID, USER_ID)).rejects.toThrow(/PostgREST error/);
  });
});

describe("setDigestFrequency", () => {
  it("saves the choice for that member and workspace without touching the sent marker", async () => {
    respond = () => new Response(null, { status: 201 });
    await setDigestFrequency(WORKSPACE_ID, USER_ID, "daily");

    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.path).toBe("ai_digest_preferences");
    expect(request.search.get("on_conflict")).toBe("workspace_id,user_id");
    expect(request.prefer).toContain("resolution=merge-duplicates");
    const body = request.body as Record<string, unknown>;
    expect(body).toMatchObject({
      workspace_id: WORKSPACE_ID,
      user_id: USER_ID,
      frequency: "daily",
    });
    // Turning the digest off and on again must not make the member due a second time.
    expect(Object.keys(body).sort()).toEqual([
      "frequency",
      "updated_at",
      "user_id",
      "workspace_id",
    ]);
  });

  it("keeps the row when turned off", async () => {
    respond = () => new Response(null, { status: 201 });
    await setDigestFrequency(WORKSPACE_ID, USER_ID, "off");

    expect(requests[0]!.method).toBe("POST");
    expect(requests[0]!.body).toMatchObject({ frequency: "off" });
  });

  it("throws when the save fails", async () => {
    respond = () => json({ code: "42501", message: "permission denied" }, 403);
    await expect(setDigestFrequency(WORKSPACE_ID, USER_ID, "daily")).rejects.toThrow(
      /PostgREST error/,
    );
  });
});

describe("claimDueDigests", () => {
  it("claims through the database function and returns typed claims", async () => {
    respond = () =>
      json([
        {
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          frequency: "daily",
          period: "2026-11-19",
          previousPeriod: null,
          role: "accountant",
          email: "member@example.test",
        },
      ]);
    const claims = await claimDueDigests(new Date("2026-11-18T20:07:00Z"), 25);

    expect(requests).toHaveLength(1);
    expect(requests[0]!.path).toBe("rpc/claim_ai_digests");
    expect(requests[0]!.body).toEqual({ p_now: "2026-11-18T20:07:00.000Z", p_limit: 25 });
    expect(claims).toEqual([
      {
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        frequency: "daily",
        period: "2026-11-19",
        previousPeriod: null,
        role: "accountant",
        email: "member@example.test",
      },
    ]);
  });

  it("returns nobody when nobody is due", async () => {
    expect(await claimDueDigests(new Date("2026-11-18T20:07:00Z"), 25)).toEqual([]);
  });

  it("refuses a result it does not recognise instead of sending from it", async () => {
    respond = () => json([{ workspaceId: WORKSPACE_ID, userId: USER_ID, frequency: "off" }]);
    await expect(claimDueDigests(new Date(), 25)).rejects.toThrow();
  });

  it("throws when the claim fails", async () => {
    respond = () => json({ code: "42883", message: "function does not exist" }, 404);
    await expect(claimDueDigests(new Date(), 25)).rejects.toThrow(/PostgREST error/);
  });
});

describe("releaseDigestClaim", () => {
  const claim: DigestClaim = {
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    frequency: "daily",
    period: "2026-11-19",
    previousPeriod: "2026-11-18",
    role: "owner",
    email: "member@example.test",
  };

  it("restores the earlier period only while the row still holds this claim", async () => {
    respond = () => new Response(null, { status: 204 });
    await releaseDigestClaim(claim);

    const request = requests[0]!;
    expect(request.method).toBe("PATCH");
    expect(request.path).toBe("ai_digest_preferences");
    expect(request.body).toEqual({ last_period: "2026-11-18" });
    expect(request.search.get("workspace_id")).toBe(`eq.${WORKSPACE_ID}`);
    expect(request.search.get("user_id")).toBe(`eq.${USER_ID}`);
    expect(request.search.get("last_period")).toBe("eq.2026-11-19");
  });

  it("clears the marker for a member who had never been sent one", async () => {
    respond = () => new Response(null, { status: 204 });
    await releaseDigestClaim({ ...claim, previousPeriod: null });

    expect(requests[0]!.body).toEqual({ last_period: null });
    expect(requests[0]!.search.get("last_period")).toBe("eq.2026-11-19");
  });
});
