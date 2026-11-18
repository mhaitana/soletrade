// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/server/infrastructure/db/types";
import { getDataClient } from "@/server/infrastructure/db/client";
import { branded } from "@/types/ids";
import { CUSTOMER_OPTIONS_LIMIT, listCustomerOptions } from "@/server/foundation/customers/index";

vi.mock("server-only", () => ({}));
vi.mock("@/server/infrastructure/db/client", () => ({ getDataClient: vi.fn() }));

const WORKSPACE_ID = branded<"WorkspaceId">("00000000-0000-4000-8000-0000000000c1");
const requests: URL[] = [];
let total = 0;

// Real query builder, fake HTTP: the server returns at most 1,000 rows, like PostgREST.
const client = createClient<Database>("https://customer-options.example.test", "test-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: {
    fetch: async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 1000), 1000);
      const rows = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({
        id: `id-${offset + i}`,
        name: `Customer ${offset + i}`,
        email: null,
        company: null,
      }));
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  },
});

beforeEach(() => {
  requests.length = 0;
  vi.mocked(getDataClient).mockReturnValue(client as never);
});

describe("listCustomerOptions", () => {
  it("reads every active customer past the 1,000-row cap, scoped to the workspace", async () => {
    total = 2300;
    const options = await listCustomerOptions(WORKSPACE_ID);
    expect(options).toHaveLength(2300);
    expect(options[2299]).toEqual({
      id: "id-2299",
      name: "Customer 2299",
      email: null,
      company: null,
    });
    expect(requests).toHaveLength(3);
    for (const url of requests) {
      expect(url.pathname).toBe("/rest/v1/customers");
      expect(url.searchParams.get("workspace_id")).toBe(`eq.${WORKSPACE_ID}`);
      expect(url.searchParams.get("deleted_at")).toBe("is.null");
      expect(url.searchParams.get("select")).toBe("id,name,email,company");
    }
  });

  it("makes one request for a small customer list", async () => {
    total = 12;
    await expect(listCustomerOptions(WORKSPACE_ID)).resolves.toHaveLength(12);
    expect(requests).toHaveLength(1);
  });

  it("stops at the option limit", async () => {
    total = CUSTOMER_OPTIONS_LIMIT + 700;
    await expect(listCustomerOptions(WORKSPACE_ID)).resolves.toHaveLength(CUSTOMER_OPTIONS_LIMIT);
  });
});
