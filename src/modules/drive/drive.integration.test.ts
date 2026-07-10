import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  auditLogs,
  driveEarnings as driveEarningsTable,
  driveTrips as driveTripsTable,
  users as usersTable,
  workspaces as workspacesTable,
  workspaceMembers,
} from "@/server/db/schema";
import {
  branded,
  type DriveEarningId,
  type DriveTripId,
  type WorkspaceId,
} from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { onEvent } from "@/server/events";
import {
  createEarning,
  createTrip,
  deleteEarning,
  deleteTrip,
  getEarning,
  getTrip,
  listEarnings,
  listTrips,
  updateEarning,
  updateTrip,
} from "./index";

/**
 * Integration tests for the Drive service against a real Postgres. Run only when
 * DATABASE_URL is set; skipped otherwise (keeps `pnpm test:ci` green without a DB).
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("drive integration (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-7000-8000-0000000000b1");
  const otherActor = branded<"UserId">("00000000-0000-7000-8000-0000000000b2");
  let ws1: WorkspaceId;
  let ws2: WorkspaceId;
  const createdEarningIds: DriveEarningId[] = [];
  const createdTripIds: DriveTripId[] = [];

  const captured: { type: string; entityId?: string; metadata?: Record<string, unknown> }[] = [];
  let unsub: (() => void) | null = null;

  beforeAll(async () => {
    const db = getDb();
    await db.insert(usersTable).values([
      { id: actor, email: "drive-actor@soletrade-test.local", fullName: "Drive Actor" },
      { id: otherActor, email: "drive-other@soletrade-test.local", fullName: "Drive Other" },
    ]);
    ws1 = await createWorkspace(actor, "Drive Test One", `drive-test-one-${Date.now()}`);
    ws2 = await createWorkspace(otherActor, "Drive Test Two", `drive-test-two-${Date.now()}`);

    const u1 = onEvent("DriveEarningsLogged", (e) => {
      captured.push({
        type: "DriveEarningsLogged",
        entityId: e.entityId,
        metadata: e.metadata as Record<string, unknown> | undefined,
      });
    });
    const u2 = onEvent("MileageLogged", (e) => {
      captured.push({
        type: "MileageLogged",
        entityId: e.entityId,
        metadata: e.metadata as Record<string, unknown> | undefined,
      });
    });
    const u3 = onEvent("DriveEarningUpdated", (e) => {
      captured.push({
        type: "DriveEarningUpdated",
        entityId: e.entityId,
        metadata: e.metadata as Record<string, unknown> | undefined,
      });
    });
    const u4 = onEvent("DriveEarningDeleted", (e) => {
      captured.push({
        type: "DriveEarningDeleted",
        entityId: e.entityId,
        metadata: e.metadata as Record<string, unknown> | undefined,
      });
    });
    const u5 = onEvent("MileageUpdated", (e) => {
      captured.push({
        type: "MileageUpdated",
        entityId: e.entityId,
        metadata: e.metadata as Record<string, unknown> | undefined,
      });
    });
    const u6 = onEvent("MileageDeleted", (e) => {
      captured.push({
        type: "MileageDeleted",
        entityId: e.entityId,
        metadata: e.metadata as Record<string, unknown> | undefined,
      });
    });
    unsub = () => {
      u1();
      u2();
      u3();
      u4();
      u5();
      u6();
    };
  });

  afterAll(async () => {
    const db = getDb();
    unsub?.();
    const workspaceIds = [ws1!, ws2!].filter(Boolean) as WorkspaceId[];
    if (workspaceIds.length === 0) return;
    await db
      .delete(driveEarningsTable)
      .where(inArray(driveEarningsTable.workspaceId, workspaceIds));
    await db.delete(driveTripsTable).where(inArray(driveTripsTable.workspaceId, workspaceIds));
    await db.delete(auditLogs).where(inArray(auditLogs.workspaceId, workspaceIds));
    await db.delete(workspaceMembers).where(inArray(workspaceMembers.workspaceId, workspaceIds));
    await db.delete(workspacesTable).where(inArray(workspacesTable.id, workspaceIds));
    await db.delete(usersTable).where(inArray(usersTable.id, [actor, otherActor]));
  });

  // ────────────────────────────── Earnings ──────────────────────────────

  it("creates an earning with the stored fields and fires DriveEarningsLogged", async () => {
    const id = await createEarning(
      ws1!,
      {
        platform: "uber",
        amountCents: 12050,
        currency: "AUD",
        date: new Date("2026-07-01"),
        description: "Airport run",
      },
      actor,
    );
    createdEarningIds.push(id);

    const row = await getEarning(ws1!, id);
    expect(row).not.toBeNull();
    expect(row!.platform).toBe("uber");
    expect(row!.amountCents).toBe(12050);
    expect(row!.currency).toBe("AUD");
    expect(row!.description).toBe("Airport run");
    expect(row!.notes).toBeNull();

    const evt = captured.find((e) => e.type === "DriveEarningsLogged" && e.entityId === id);
    expect(evt).toBeDefined();
    expect(evt?.metadata).toMatchObject({ platform: "uber", amountCents: 12050 });
  });

  it("rejects an earning with a non-positive amount", async () => {
    await expect(
      createEarning(
        ws1!,
        {
          platform: "uber",
          amountCents: 0,
          date: new Date("2026-07-02"),
          description: "Zero",
        },
        actor,
      ),
    ).rejects.toThrow(/greater than 0/i);
  });

  it("rejects an earning with an unknown platform", async () => {
    await expect(
      createEarning(
        ws1!,
        {
          platform: "not-a-platform",
          amountCents: 1000,
          date: new Date("2026-07-02"),
          description: "Bad platform",
        },
        actor,
      ),
    ).rejects.toThrow(/Unknown platform/i);
  });

  it("isolates earnings per workspace (no IDOR)", async () => {
    const cross = await getEarning(ws2!, createdEarningIds[0]!);
    expect(cross).toBeNull();

    const ws1List = await listEarnings(ws1!);
    const ws2List = await listEarnings(ws2!);
    expect(ws1List.some((e) => e.id === createdEarningIds[0])).toBe(true);
    expect(ws2List.some((e) => e.id === createdEarningIds[0])).toBe(false);
  });

  it("updates an earning and fires DriveEarningUpdated", async () => {
    await updateEarning(
      ws1!,
      createdEarningIds[0]!,
      { amountCents: 9999, description: "Airport run (revised)" },
      actor,
    );
    const row = await getEarning(ws1!, createdEarningIds[0]!);
    expect(row!.amountCents).toBe(9999);
    expect(row!.description).toBe("Airport run (revised)");

    const evt = captured.find(
      (e) => e.type === "DriveEarningUpdated" && e.entityId === createdEarningIds[0],
    );
    expect(evt).toBeDefined();
    expect(evt?.metadata).toMatchObject({
      amountCents: 9999,
      description: "Airport run (revised)",
    });
  });

  it("updateEarning on another workspace's row throws (not found)", async () => {
    await expect(
      updateEarning(ws2!, createdEarningIds[0]!, { amountCents: 1 }, otherActor),
    ).rejects.toThrow(/not found/i);
    const row = await getEarning(ws1!, createdEarningIds[0]!);
    expect(row!.amountCents).toBe(9999); // unchanged
  });

  it("filters earnings by platform and search", async () => {
    const uber = await listEarnings(ws1!, { platform: "uber" });
    expect(uber.every((e) => e.platform === "uber")).toBe(true);
    expect(uber.some((e) => e.id === createdEarningIds[0])).toBe(true);

    const byDescription = await listEarnings(ws1!, { search: "Airport" });
    expect(byDescription.length).toBeGreaterThan(0);
    expect(byDescription.some((e) => e.id === createdEarningIds[0])).toBe(true);
  });

  it("deletes an earning and fires DriveEarningDeleted", async () => {
    const id = await createEarning(
      ws1!,
      {
        platform: "doordash",
        amountCents: 5000,
        date: new Date("2026-07-03"),
        description: "To delete",
      },
      actor,
    );
    const ok = await deleteEarning(ws1!, id, actor);
    expect(ok).toBe(true);
    expect(await getEarning(ws1!, id)).toBeNull();

    const evt = captured.find((e) => e.type === "DriveEarningDeleted" && e.entityId === id);
    expect(evt).toBeDefined();
    expect(evt?.metadata).toMatchObject({ earningId: id });

    // Deleting from another workspace returns false (not found there).
    const refused = await deleteEarning(ws2!, createdEarningIds[0]!, otherActor);
    expect(refused).toBe(false);
  });

  // ─────────────────────────────── Trips ───────────────────────────────

  it("creates a trip with the stored fields and fires MileageLogged", async () => {
    const id = await createTrip(
      ws1!,
      {
        platform: "uber",
        distanceMeters: 45200, // 45.2 km
        date: new Date("2026-07-01"),
        purpose: "Airport pickup",
      },
      actor,
    );
    createdTripIds.push(id);

    const row = await getTrip(ws1!, id);
    expect(row).not.toBeNull();
    expect(row!.platform).toBe("uber");
    expect(row!.distanceMeters).toBe(45200);
    expect(row!.purpose).toBe("Airport pickup");
    expect(row!.notes).toBeNull();

    const evt = captured.find((e) => e.type === "MileageLogged" && e.entityId === id);
    expect(evt).toBeDefined();
    expect(evt?.metadata).toMatchObject({ platform: "uber", distanceMeters: 45200 });
  });

  it("rejects a trip with a non-positive distance", async () => {
    await expect(
      createTrip(
        ws1!,
        {
          platform: "uber",
          distanceMeters: 0,
          date: new Date("2026-07-02"),
          purpose: "Zero",
        },
        actor,
      ),
    ).rejects.toThrow(/greater than 0/i);
  });

  it("isolates trips per workspace (no IDOR)", async () => {
    const cross = await getTrip(ws2!, createdTripIds[0]!);
    expect(cross).toBeNull();

    const ws1List = await listTrips(ws1!);
    const ws2List = await listTrips(ws2!);
    expect(ws1List.some((t) => t.id === createdTripIds[0])).toBe(true);
    expect(ws2List.some((t) => t.id === createdTripIds[0])).toBe(false);
  });

  it("updates a trip and fires MileageUpdated", async () => {
    await updateTrip(
      ws1!,
      createdTripIds[0]!,
      { distanceMeters: 50000, purpose: "Airport pickup (revised)" },
      actor,
    );
    const row = await getTrip(ws1!, createdTripIds[0]!);
    expect(row!.distanceMeters).toBe(50000);
    expect(row!.purpose).toBe("Airport pickup (revised)");

    const evt = captured.find(
      (e) => e.type === "MileageUpdated" && e.entityId === createdTripIds[0],
    );
    expect(evt).toBeDefined();
    expect(evt?.metadata).toMatchObject({ distanceMeters: 50000, amountCents: 4250 });
  });

  it("updateTrip on another workspace's row throws (not found)", async () => {
    await expect(
      updateTrip(ws2!, createdTripIds[0]!, { distanceMeters: 1 }, otherActor),
    ).rejects.toThrow(/not found/i);
  });

  it("filters trips by platform and search", async () => {
    const uber = await listTrips(ws1!, { platform: "uber" });
    expect(uber.every((t) => t.platform === "uber")).toBe(true);
    expect(uber.some((t) => t.id === createdTripIds[0])).toBe(true);

    const byPurpose = await listTrips(ws1!, { search: "Airport" });
    expect(byPurpose.length).toBeGreaterThan(0);
    expect(byPurpose.some((t) => t.id === createdTripIds[0])).toBe(true);
  });

  it("deletes a trip and fires MileageDeleted", async () => {
    const id = await createTrip(
      ws1!,
      {
        platform: "doordash",
        distanceMeters: 12000,
        date: new Date("2026-07-04"),
        purpose: "To delete",
      },
      actor,
    );
    const ok = await deleteTrip(ws1!, id, actor);
    expect(ok).toBe(true);
    expect(await getTrip(ws1!, id)).toBeNull();

    const evt = captured.find((e) => e.type === "MileageDeleted" && e.entityId === id);
    expect(evt).toBeDefined();
    expect(evt?.metadata).toMatchObject({ tripId: id });

    // Deleting from another workspace returns false (not found there).
    const refused = await deleteTrip(ws2!, createdTripIds[0]!, otherActor);
    expect(refused).toBe(false);
  });
});
