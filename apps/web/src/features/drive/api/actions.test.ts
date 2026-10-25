import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { branded } from "@/types/ids";

const mocks = vi.hoisted(() => ({
  requireWorkspaceContext: vi.fn(),
  authorizeOrAudit: vi.fn(),
  createEarnings: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/application/auth/workspace-context", () => ({
  requireWorkspaceContext: mocks.requireWorkspaceContext,
}));
vi.mock("@/server/application/auth/authorization/index", () => ({
  authorizeOrAudit: mocks.authorizeOrAudit,
}));
vi.mock("@/server/domains/drive/index", () => ({ createEarnings: mocks.createEarnings }));
vi.mock("@/server/foundation/workspaces/index", () => ({ getWorkspace: vi.fn() }));
vi.mock("@/server/foundation/module-installations/index", () => ({
  isModuleEnabled: vi.fn(),
}));

import { createEarningsAction } from "./actions";

const workspaceId = branded<"WorkspaceId">("00000000-0000-4000-8000-0000000000d1");
const actorId = branded<"UserId">("00000000-0000-4000-8000-0000000000d2");
const context = { workspaceId, user: { id: actorId } };
const earning = {
  platform: "uber",
  amountCents: 12550,
  date: "2026-10-20",
  description: "Daily earnings",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireWorkspaceContext.mockResolvedValue(context);
  mocks.authorizeOrAudit.mockResolvedValue({ ok: true });
  mocks.createEarnings.mockResolvedValue(["earning-one", "earning-two"]);
});
afterEach(() => vi.restoreAllMocks());

describe("createEarningsAction", () => {
  it("reports the invalid row and never saves an earlier valid row", async () => {
    const result = await createEarningsAction({
      earnings: [earning, { ...earning, amountCents: 0, platform: "unknown", description: " " }],
    });

    expect(result).toMatchObject({
      ok: false,
      fieldErrors: {
        "earnings.1.amountCents": expect.any(Array),
        "earnings.1.platform": expect.any(Array),
        "earnings.1.description": expect.any(Array),
      },
    });
    expect(mocks.createEarnings).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([0, 32])("rejects a batch containing %i earnings", async (count) => {
    const result = await createEarningsAction({
      earnings: Array.from({ length: count }, () => earning),
    });
    expect(result).toMatchObject({ ok: false, fieldErrors: { earnings: expect.any(Array) } });
    expect(mocks.createEarnings).not.toHaveBeenCalled();
  });

  it("allows the maximum batch of 31 earnings", async () => {
    const result = await createEarningsAction({
      earnings: Array.from({ length: 31 }, () => earning),
    });
    expect(result.ok).toBe(true);
    expect(mocks.createEarnings.mock.calls[0]?.[1]).toHaveLength(31);
  });

  it("requires manage:drive before saving", async () => {
    mocks.authorizeOrAudit.mockResolvedValue({ ok: false });

    expect(await createEarningsAction({ earnings: [earning] })).toMatchObject({ ok: false });
    expect(mocks.authorizeOrAudit).toHaveBeenCalledWith(context, "manage:drive");
    expect(mocks.createEarnings).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("requires an authenticated workspace", async () => {
    mocks.requireWorkspaceContext.mockRejectedValue(new Error("Authentication required"));

    await expect(createEarningsAction({ earnings: [earning] })).rejects.toThrow(
      "Authentication required",
    );
    expect(mocks.createEarnings).not.toHaveBeenCalled();
  });

  it("uses the authenticated workspace and actor for one normalized batch", async () => {
    const result = await createEarningsAction({
      workspaceId: "untrusted-workspace",
      actorId: "untrusted-actor",
      earnings: [
        {
          ...earning,
          description: "  First day  ",
          notes: "  Rainy  ",
          workspaceId: "untrusted-workspace",
        },
        {
          ...earning,
          platform: "doordash",
          amountCents: 7900,
          currency: "AUD",
          date: "2026-10-21",
        },
      ],
    });

    expect(result).toEqual({ ok: true, earningIds: ["earning-one", "earning-two"] });
    expect(mocks.createEarnings).toHaveBeenCalledExactlyOnceWith(
      workspaceId,
      [
        {
          platform: "uber",
          amountCents: 12550,
          date: new Date("2026-10-20"),
          description: "First day",
          notes: "Rainy",
        },
        {
          platform: "doordash",
          amountCents: 7900,
          currency: "AUD",
          date: new Date("2026-10-21"),
          description: "Daily earnings",
          notes: null,
        },
      ],
      actorId,
    );
    expect(mocks.revalidatePath.mock.calls).toEqual([["/drive"], ["/books"], ["/dashboard"]]);
  });

  it("marks a database transport failure as unconfirmed so retrying can be avoided", async () => {
    mocks.createEarnings.mockRejectedValue(new Error("Response lost after commit"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await createEarningsAction({ earnings: [earning] })).toEqual({
      ok: false,
      unconfirmed: true,
      error:
        "We couldn’t confirm whether these earnings were saved. Check your earnings before trying again to avoid duplicates.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
