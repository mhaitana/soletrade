// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { requireWorkspaceContext } from "@/server/application/auth/workspace-context";
import { getWorkspace } from "@/server/foundation/workspaces/index";
import {
  getDigestFrequency,
  setDigestFrequency,
} from "@/server/foundation/notifications/digest-preferences";
import { branded } from "@/types/ids";
import { loadDigestSettings, setDigestFrequencyAction } from "@/features/assistant/api/digest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/application/auth/workspace-context", () => ({
  requireWorkspaceContext: vi.fn(),
}));
vi.mock("@/server/foundation/workspaces/index", () => ({ getWorkspace: vi.fn() }));
vi.mock("@/server/foundation/notifications/digest-preferences", () => ({
  getDigestFrequency: vi.fn(),
  setDigestFrequency: vi.fn(),
}));

const WORKSPACE_ID = branded<"WorkspaceId">("00000000-0000-4000-8000-0000000000c1");
const USER_ID = branded<"UserId">("00000000-0000-4000-8000-0000000000c2");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireWorkspaceContext).mockResolvedValue({
    workspaceId: WORKSPACE_ID,
    role: "employee",
    user: { id: USER_ID, email: "member@example.test" },
  });
  vi.mocked(getWorkspace).mockResolvedValue({
    name: "Acme Plumbing",
    timezone: "Australia/Sydney",
  } as never);
  vi.mocked(getDigestFrequency).mockResolvedValue("off");
  vi.mocked(setDigestFrequency).mockResolvedValue();
});

describe("loadDigestSettings", () => {
  it("returns the signed-in member's own choice for the active workspace", async () => {
    vi.mocked(getDigestFrequency).mockResolvedValue("weekly");

    expect(await loadDigestSettings()).toEqual({
      frequency: "weekly",
      workspaceName: "Acme Plumbing",
      timezone: "Australia/Sydney",
      email: "member@example.test",
    });
    expect(getDigestFrequency).toHaveBeenCalledWith(WORKSPACE_ID, USER_ID);
  });

  it("shows UTC when the workspace timezone is not a known one", async () => {
    vi.mocked(getWorkspace).mockResolvedValue({ name: "Acme", timezone: "Not/AZone" } as never);

    expect(await loadDigestSettings()).toMatchObject({ frequency: "off", timezone: "UTC" });
  });
});

describe("setDigestFrequencyAction", () => {
  it.each(["off", "daily", "weekly"] as const)(
    "saves %s for the signed-in member",
    async (frequency) => {
      expect(await setDigestFrequencyAction({ frequency })).toEqual({ ok: true, frequency });
      expect(setDigestFrequency).toHaveBeenCalledWith(WORKSPACE_ID, USER_ID, frequency);
      expect(revalidatePath).toHaveBeenCalledWith("/settings/assistant");
    },
  );

  it("is open to every role, because the choice is the member's own", async () => {
    for (const role of [
      "owner",
      "admin",
      "manager",
      "accountant",
      "employee",
      "readonly",
    ] as const) {
      vi.mocked(requireWorkspaceContext).mockResolvedValue({
        workspaceId: WORKSPACE_ID,
        role,
        user: { id: USER_ID, email: "member@example.test" },
      });
      expect(await setDigestFrequencyAction({ frequency: "daily" })).toMatchObject({ ok: true });
    }
  });

  it("ignores a workspace or user id sent by the client", async () => {
    await setDigestFrequencyAction({
      frequency: "daily",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
    });

    expect(setDigestFrequency).toHaveBeenCalledTimes(1);
    expect(setDigestFrequency).toHaveBeenCalledWith(WORKSPACE_ID, USER_ID, "daily");
  });

  it("rejects anything that is not one of the three choices, without saving", async () => {
    for (const input of [{ frequency: "hourly" }, { frequency: "" }, {}, null, "daily", 7]) {
      expect(await setDigestFrequencyAction(input)).toEqual({
        ok: false,
        error: "Choose Off, Daily or Weekly.",
      });
    }
    expect(setDigestFrequency).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a failed save instead of claiming success", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(setDigestFrequency).mockRejectedValue(new Error("PostgREST error [42501]"));

    expect(await setDigestFrequencyAction({ frequency: "daily" })).toEqual({
      ok: false,
      error: "Your choice could not be saved. Try again.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
