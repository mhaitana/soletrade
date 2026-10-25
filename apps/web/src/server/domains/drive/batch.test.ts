import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EarningInput } from "@/lib/domain/drive/types";
import { branded } from "@/types/ids";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  getWorkspace: vi.fn(),
  publishEvent: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock("@/server/infrastructure/db/client", () => ({
  getDataClient: () => ({ from: mocks.from }),
}));
vi.mock("@/server/foundation/workspaces", () => ({ getWorkspace: mocks.getWorkspace }));
vi.mock("@/server/infrastructure/events", () => ({ publishEvent: mocks.publishEvent }));
vi.mock("@/server/foundation/audit", () => ({ writeAudit: mocks.writeAudit }));

import { createEarnings } from "./index";

const workspaceId = branded<"WorkspaceId">("00000000-0000-4000-8000-0000000000b1");
const actorId = branded<"UserId">("00000000-0000-4000-8000-0000000000b2");
const firstId = "00000000-0000-4000-8000-0000000000b3";
const secondId = "00000000-0000-4000-8000-0000000000b4";
const earning: EarningInput = {
  platform: "uber",
  amountCents: 12550,
  date: new Date("2026-10-20"),
  description: "First day",
};
const savedRows = [
  {
    id: firstId,
    platform: "uber",
    amount_cents: 12550,
    currency: "NZD",
    date: "2026-10-20T00:00:00",
    description: "First day",
  },
  {
    id: secondId,
    platform: "doordash",
    amount_cents: 7900,
    currency: "AUD",
    date: "2026-10-21T00:00:00",
    description: "Second day",
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.from.mockReturnValue({ insert: mocks.insert });
  mocks.insert.mockReturnValue({ select: mocks.select });
  mocks.select.mockResolvedValue({ data: savedRows, error: null });
  mocks.getWorkspace.mockResolvedValue({ defaultCurrency: "NZD" });
  mocks.publishEvent.mockResolvedValue(undefined);
  mocks.writeAudit.mockResolvedValue("audit-id");
});
afterEach(() => vi.restoreAllMocks());

describe("createEarnings", () => {
  it("inserts all rows in one statement using only the trusted workspace", async () => {
    const ids = await createEarnings(
      workspaceId,
      [
        { ...earning, description: "  First day  ", notes: "  Rainy  " },
        {
          ...earning,
          platform: "doordash",
          amountCents: 7900,
          currency: "AUD",
          date: new Date("2026-10-21"),
          description: "Second day",
        },
      ],
      actorId,
    );

    expect(ids).toEqual([firstId, secondId]);
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("drive_earnings");
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith([
      {
        workspace_id: workspaceId,
        platform: "uber",
        amount_cents: 12550,
        currency: "NZD",
        date: "2026-10-20T00:00:00.000Z",
        description: "First day",
        notes: "Rainy",
      },
      {
        workspace_id: workspaceId,
        platform: "doordash",
        amount_cents: 7900,
        currency: "AUD",
        date: "2026-10-21T00:00:00.000Z",
        description: "Second day",
        notes: null,
      },
    ]);
    expect(mocks.getWorkspace).toHaveBeenCalledExactlyOnceWith(workspaceId);
  });

  it.each([
    { amountCents: 0 },
    { amountCents: 1.5 },
    { amountCents: Number.NaN },
    { amountCents: 2_147_483_648 },
    { platform: "unknown" },
    { date: new Date("invalid") },
    { description: " " },
    { description: "x".repeat(281) },
    { currency: "AU" },
    { notes: "x".repeat(2001) },
  ])("validates every row before any database call: %j", async (invalid) => {
    await expect(
      createEarnings(workspaceId, [earning, { ...earning, ...invalid }], actorId),
    ).rejects.toThrow();
    expect(mocks.getWorkspace).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.publishEvent).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it.each([0, 32])("rejects a batch of %i rows without a write", async (count) => {
    await expect(
      createEarnings(
        workspaceId,
        Array.from({ length: count }, () => earning),
        actorId,
      ),
    ).rejects.toThrow();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("publishes and audits each saved earning using its returned values", async () => {
    // Returned rows are not required to have input order.
    mocks.select.mockResolvedValue({ data: [...savedRows].reverse(), error: null });
    await createEarnings(
      workspaceId,
      [earning, { ...earning, platform: "doordash", amountCents: 7900 }],
      actorId,
    );

    expect(mocks.publishEvent).toHaveBeenCalledTimes(2);
    expect(mocks.publishEvent).toHaveBeenCalledWith({
      type: "DriveEarningsLogged",
      workspaceId,
      actorUserId: actorId,
      entityType: "drive_earning",
      entityId: secondId,
      metadata: {
        platform: "doordash",
        amountCents: 7900,
        currency: "AUD",
        date: new Date("2026-10-21"),
        description: "Second day",
      },
    });
    expect(mocks.writeAudit).toHaveBeenCalledTimes(2);
    expect(mocks.writeAudit).toHaveBeenCalledWith({
      workspaceId,
      actorUserId: actorId,
      action: "drive.earning.create",
      targetType: "drive_earning",
      targetId: firstId,
      metadata: { platform: "uber", amountCents: 12550 },
    });
  });

  it("emits no events or audits when the atomic insert fails", async () => {
    mocks.select.mockResolvedValue({
      data: null,
      error: { code: "23514", message: "Injected mirror failure" },
    });
    await expect(createEarnings(workspaceId, [earning, earning], actorId)).rejects.toThrow(
      "Injected mirror failure",
    );
    expect(mocks.publishEvent).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("returns saved IDs and attempts every audit if a post-save audit fails", async () => {
    const auditError = new Error("Audit unavailable");
    mocks.writeAudit.mockRejectedValueOnce(auditError);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(createEarnings(workspaceId, [earning, earning], actorId)).resolves.toEqual([
      firstId,
      secondId,
    ]);
    expect(mocks.writeAudit).toHaveBeenCalledTimes(2);
    expect(mocks.publishEvent).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(firstId), auditError);
  });
});
