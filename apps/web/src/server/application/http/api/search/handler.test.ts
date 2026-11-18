// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRateLimits } from "@/server/infrastructure/rate-limit/index";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  tryWorkspaceContext: vi.fn(),
  searchWorkspace: vi.fn(),
}));

vi.mock("@/server/application/auth/workspace-context", () => ({
  tryWorkspaceContext: mocks.tryWorkspaceContext,
}));
vi.mock("@/server/application/http/api/search/search", () => ({
  searchWorkspace: mocks.searchWorkspace,
}));

import { GET, SEARCH_RATE_LIMIT } from "@/server/application/http/api/search/handler";

const request = (q: string) => new Request(`https://app.example.test/api/search?q=${q}`);

beforeEach(() => {
  clearRateLimits();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  mocks.tryWorkspaceContext.mockResolvedValue({
    workspaceId: "00000000-0000-4000-8000-0000000000b1",
    user: { id: "00000000-0000-4000-8000-0000000000b2" },
  });
  mocks.searchWorkspace.mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/search", () => {
  it("searches the signed-in member's workspace", async () => {
    const response = await GET(request("acme"));
    expect(response.status).toBe(200);
    expect(mocks.searchWorkspace).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-0000000000b1",
      "acme",
      { limitPerModule: undefined },
    );
  });

  it("returns 401 without a workspace session", async () => {
    mocks.tryWorkspaceContext.mockResolvedValue(null);
    expect((await GET(request("acme"))).status).toBe(401);
    expect(mocks.searchWorkspace).not.toHaveBeenCalled();
  });

  it("refuses searches past the per-member limit without touching the database", async () => {
    for (let i = 0; i < SEARCH_RATE_LIMIT.max; i += 1) {
      expect((await GET(request(`q${i}`))).status).toBe(200);
    }
    const limited = await GET(request("one-more"));
    expect(limited.status).toBe(429);
    expect(mocks.searchWorkspace).toHaveBeenCalledTimes(SEARCH_RATE_LIMIT.max);
  });
});
