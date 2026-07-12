import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the two collaborators so requireWorkspaceContext is exercised without a
// DB or Supabase. redirect() is mocked to throw a sentinel so we can assert the
// redirect branches.
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

vi.mock("@/server/auth/session", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/platform/workspaces", () => ({
  listUserWorkspaces: vi.fn(),
  getMembershipRole: vi.fn(),
  getActiveWorkspaceId: vi.fn(),
  setActiveWorkspaceId: vi.fn(),
  ACTIVE_WORKSPACE_COOKIE: "soletrade:wid",
}));

import { requireWorkspaceContext } from "./context";
import { getCurrentUser } from "@/server/auth/session";
import {
  getActiveWorkspaceId,
  getMembershipRole,
  listUserWorkspaces,
  setActiveWorkspaceId,
} from "@/platform/workspaces";
import { branded } from "@/shared/types/ids";

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockListUserWorkspaces = vi.mocked(listUserWorkspaces);
const mockGetMembershipRole = vi.mocked(getMembershipRole);
const mockGetActiveWorkspaceId = vi.mocked(getActiveWorkspaceId);
const mockSetActiveWorkspaceId = vi.mocked(setActiveWorkspaceId);

const UID = () => branded<"UserId">("user-1");
const WID = (s: string) => branded<"WorkspaceId">(s);

function setupMembership(
  role: "owner" | "admin" | "manager" | "accountant" | "employee" | "readonly" = "owner",
) {
  return [{ workspaceId: WID("ws-1"), name: "Acme", slug: "acme", role }];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue({ id: UID(), email: "owner@example.com" });
  mockGetMembershipRole.mockResolvedValue("owner");
  mockSetActiveWorkspaceId.mockResolvedValue(undefined);
});

describe("requireWorkspaceContext", () => {
  it("returns context from the cookie-matched membership", async () => {
    const memberships = setupMembership("admin");
    mockListUserWorkspaces.mockResolvedValue(memberships);
    mockGetActiveWorkspaceId.mockResolvedValue(WID("ws-1"));
    mockGetMembershipRole.mockResolvedValue("admin");

    const ctx = await requireWorkspaceContext();

    expect(ctx.user.id).toBe("user-1");
    expect(ctx.workspaceId).toBe("ws-1");
    expect(ctx.role).toBe("admin");
    // Cookie already valid → no repair write.
    expect(mockSetActiveWorkspaceId).not.toHaveBeenCalled();
  });

  it("uses the first membership when the cookie is missing, without writing the cookie", async () => {
    // The resolver is read-only (called from Server Component renders, where Next
    // forbids cookies().set()). It falls back to the first membership but leaves the
    // cookie unset - the cookie is persisted only by explicit activation actions
    // (switchWorkspace / createWorkspace / acceptInvite).
    const memberships = [
      { workspaceId: WID("ws-1"), name: "Acme", slug: "acme", role: "owner" as const },
      { workspaceId: WID("ws-2"), name: "Beta", slug: "beta", role: "admin" as const },
    ];
    mockListUserWorkspaces.mockResolvedValue(memberships);
    mockGetActiveWorkspaceId.mockResolvedValue(null);

    const ctx = await requireWorkspaceContext();

    expect(ctx.workspaceId).toBe("ws-1");
    expect(mockSetActiveWorkspaceId).not.toHaveBeenCalled();
  });

  it("falls back to the first membership when the cookie points at a revoked workspace, without writing the cookie", async () => {
    const memberships = setupMembership("manager");
    mockListUserWorkspaces.mockResolvedValue(memberships);
    // Cookie references a workspace the user is no longer a member of.
    mockGetActiveWorkspaceId.mockResolvedValue(WID("ws-gone"));

    const ctx = await requireWorkspaceContext();

    expect(ctx.workspaceId).toBe("ws-1");
    expect(mockSetActiveWorkspaceId).not.toHaveBeenCalled();
  });

  it("redirects to /onboarding when the user has no workspaces", async () => {
    mockListUserWorkspaces.mockResolvedValue([]);
    mockGetActiveWorkspaceId.mockResolvedValue(null);

    await expect(requireWorkspaceContext()).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("redirects to /onboarding when there is no session (getCurrentUser null)", async () => {
    // tryWorkspaceContext maps a null session to null → requireWorkspaceContext redirects.
    // Route handlers consume the null directly (401); server components/actions redirect.
    mockGetCurrentUser.mockResolvedValue(null);

    await expect(requireWorkspaceContext()).rejects.toThrow("REDIRECT:/onboarding");
    expect(mockListUserWorkspaces).not.toHaveBeenCalled();
  });

  it("redirects to /onboarding when membership role is null (revoked mid-session)", async () => {
    mockListUserWorkspaces.mockResolvedValue(setupMembership());
    mockGetActiveWorkspaceId.mockResolvedValue(WID("ws-1"));
    mockGetMembershipRole.mockResolvedValue(null);

    await expect(requireWorkspaceContext()).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("never trusts the client: workspaceId comes from server-resolved membership", async () => {
    const memberships = setupMembership("accountant");
    mockListUserWorkspaces.mockResolvedValue(memberships);
    mockGetActiveWorkspaceId.mockResolvedValue(WID("ws-1"));
    mockGetMembershipRole.mockResolvedValue("accountant");

    const ctx = await requireWorkspaceContext();
    // The role returned to callers is the DB-resolved role, not a client value.
    expect(mockGetMembershipRole).toHaveBeenCalledWith(WID("ws-1"), UID());
    expect(ctx.role).toBe("accountant");
  });
});
