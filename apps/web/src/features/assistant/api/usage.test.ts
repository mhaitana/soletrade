// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLES } from "@/lib/domain/permissions/index";

/**
 * The Usage card's loader: who may see a workspace's usage, and that the workspace comes
 * from the signed-in session. `authorize` is the real one, so the roles are the real roles.
 */

const mocks = vi.hoisted(() => ({
  requireWorkspaceContext: vi.fn(),
  getAssistantUsageOverview: vi.fn(),
}));

vi.mock("@/server/application/auth/workspace-context", () => ({
  requireWorkspaceContext: mocks.requireWorkspaceContext,
}));
vi.mock("@/server/application/assistant/usage", () => ({
  getAssistantUsageOverview: mocks.getAssistantUsageOverview,
}));

import { loadAssistantUsage } from "@/features/assistant/api/usage";

const workspaceId = "00000000-0000-4000-8000-00000000a001";
const usage = { current: { month: "2026-11" }, previous: [] };

beforeEach(() => {
  mocks.requireWorkspaceContext.mockReset();
  mocks.getAssistantUsageOverview.mockReset().mockResolvedValue(usage);
});

describe("loadAssistantUsage", () => {
  it.each(["owner", "admin"] as const)("shows the workspace's usage to an %s", async (role) => {
    mocks.requireWorkspaceContext.mockResolvedValue({ workspaceId, role, user: { id: "u1" } });
    expect(await loadAssistantUsage()).toEqual({ access: true, usage });
    // The workspace is the session's own; the loader takes no input to override it.
    expect(mocks.getAssistantUsageOverview).toHaveBeenCalledWith(workspaceId);
    expect(loadAssistantUsage).toHaveLength(0);
  });

  it("reports that usage could not be read instead of failing the page", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.requireWorkspaceContext.mockResolvedValue({
      workspaceId,
      role: "owner",
      user: { id: "u1" },
    });
    mocks.getAssistantUsageOverview.mockRejectedValue(new Error("relation does not exist"));
    expect(await loadAssistantUsage()).toEqual({ access: true, usage: null });
    expect(errors).toHaveBeenCalledWith("[assistant] could not load usage:", expect.any(Error));
    errors.mockRestore();
  });

  it("lets a sign-in redirect through", async () => {
    // Resolving the session may redirect by throwing; that must never be swallowed.
    mocks.requireWorkspaceContext.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(loadAssistantUsage()).rejects.toThrow("NEXT_REDIRECT");
  });

  it.each(ROLES.filter((role) => role !== "owner" && role !== "admin"))(
    "does not read usage for a %s",
    async (role) => {
      mocks.requireWorkspaceContext.mockResolvedValue({ workspaceId, role, user: { id: "u1" } });
      expect(await loadAssistantUsage()).toEqual({ access: false });
      expect(mocks.getAssistantUsageOverview).not.toHaveBeenCalled();
    },
  );
});
