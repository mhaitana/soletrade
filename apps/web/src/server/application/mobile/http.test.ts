import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  profile: vi.fn(),
  getCurrentUser: vi.fn(),
  ensureUserMirror: vi.fn(),
  getWorkspace: vi.fn(),
  getMembershipRole: vi.fn(),
  rateLimit: vi.fn(),
}));
vi.mock("@/server/infrastructure/db/client", () => ({
  getDataClient: () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }),
  }),
}));
vi.mock("@/server/application/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/foundation/users", () => ({ ensureUserMirror: mocks.ensureUserMirror }));
vi.mock("@/server/foundation/workspaces", () => ({
  getWorkspace: mocks.getWorkspace,
  getMembershipRole: mocks.getMembershipRole,
}));
vi.mock("@/server/infrastructure/rate-limit", () => ({ rateLimit: mocks.rateLimit }));

import {
  requireMobileContext,
  requireMobileUser,
  mobileRoute,
  MobileApiError,
} from "@/server/application/mobile/http";

const userId = "56ae3410-2471-4f26-9e17-3733ec19b29b";
const workspaceId = "87bf56a6-80a6-43fe-bc40-67d1caaf932c";
const authenticated = () =>
  new Request("https://business.example/api/v1/bootstrap", {
    headers: { authorization: "Bearer verified-access-token" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: userId, email: "owner@example.com", user_metadata: {} } },
    error: null,
  });
  mocks.profile.mockResolvedValue({ data: { id: userId, deleted_at: null }, error: null });
  mocks.getMembershipRole.mockResolvedValue("owner");
  mocks.getWorkspace.mockResolvedValue({ id: workspaceId, deletedAt: null });
  mocks.rateLimit.mockResolvedValue(true);
});

describe("mobile request authorization", () => {
  it("rejects cross-origin cookie mutations before resolving the browser session", async () => {
    const request = new Request("https://business.example/api/v1/me/preferences", {
      method: "POST",
      headers: { origin: "https://other.example" },
    });
    await expect(requireMobileUser(request)).rejects.toMatchObject({
      status: 403,
      code: "INVALID_ORIGIN",
    });
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
  });
  it("verifies the bearer token with Auth instead of trusting decoded claims", async () => {
    expect((await requireMobileUser(authenticated())).id).toBe(userId);
    expect(mocks.getUser).toHaveBeenCalledWith("verified-access-token");
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
  });
  it("does not fall back to browser cookies for an invalid explicit bearer token", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad token" } });
    await expect(requireMobileUser(authenticated())).rejects.toMatchObject({ status: 401 });
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
  });
  it("rejects closed accounts even while an access token remains valid", async () => {
    mocks.profile.mockResolvedValue({
      data: { id: userId, deleted_at: new Date().toISOString() },
      error: null,
    });
    await expect(requireMobileUser(authenticated())).rejects.toMatchObject({ status: 403 });
    expect(mocks.ensureUserMirror).not.toHaveBeenCalled();
  });
  it("rejects an unknown workspace rather than choosing another membership", async () => {
    mocks.getMembershipRole.mockResolvedValue(null);
    await expect(requireMobileContext(authenticated(), workspaceId)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("rejects suspended workspaces", async () => {
    mocks.getWorkspace.mockResolvedValue({ id: workspaceId, deletedAt: new Date().toISOString() });
    await expect(requireMobileContext(authenticated(), workspaceId)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("validates workspace identifiers before querying membership", async () => {
    await expect(requireMobileContext(authenticated(), "not-a-uuid")).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.getMembershipRole).not.toHaveBeenCalled();
  });
  it("returns sanitized JSON for unexpected backend failures", async () => {
    const response = await mobileRoute(async () => {
      throw new Error("database password secret");
    });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("password secret");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("preserves actionable expected errors", async () => {
    const response = await mobileRoute(async () => {
      throw new MobileApiError("STALE_RECORD", "Refresh before editing.", 409);
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "STALE_RECORD", message: "Refresh before editing." },
    });
  });
});
