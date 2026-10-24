import { z } from "zod";
import { isDrivePlatform } from "@/shared/constants/drive-platforms";
import { branded } from "@/shared/types/ids";
import * as drive from "@/modules/drive";
import { getFile } from "@/platform/files";
import {
  cents,
  checkVersion,
  createOnce,
  currency,
  date,
  found,
  gate,
  id,
  missing,
  notes,
  offset,
  page,
  parse,
  splitBody,
  text,
  type Context,
  type Method,
  type Query,
} from "./common";
export const earningSchema = z
  .object({
    platform: z.string().min(1).max(50).refine(isDrivePlatform, "Unknown Drive platform"),
    amountCents: cents.positive(),
    currency,
    date,
    description: text,
    notes,
  })
  .strict();
export const tripSchema = z
  .object({
    vehicleId: z.uuid().nullable().optional(),
    platform: z.string().min(1).max(50).refine(isDrivePlatform, "Unknown Drive platform"),
    distanceMeters: z.number().int().positive().max(2_147_483_647),
    date,
    purpose: z.string().trim().max(280).nullable().optional(),
    notes,
  })
  .strict();
export const vehicleSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    make: z.string().trim().max(100).nullable().optional(),
    model: z.string().trim().max(100).nullable().optional(),
    year: z.number().int().min(1900).max(2200).nullable().optional(),
    odometerKm: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();
const expenseType = z.enum(["fuel", "maintenance", "insurance", "registration", "other"]);
export const expenseSchema = z
  .object({
    vehicleId: z.uuid(),
    type: expenseType,
    amountCents: cents.positive(),
    currency,
    date,
    description: text,
    odometerKm: z.number().int().nonnegative().max(2_147_483_647).nullable().optional(),
    receiptFileId: z.uuid().nullable().optional(),
    notes,
  })
  .strict();
export async function readDrive(ctx: Context, p: string[], q: Query): Promise<unknown | Response> {
  await gate(ctx, p[0] === "export" ? "manage:drive" : "view:drive", "drive");
  const opts = {
    search: q.search,
    dateFrom: q.dateFrom,
    dateTo: q.dateTo,
    platform: q.platform,
    limit: q.limit + 1,
    offset: offset(q),
  };
  if (p.length === 1) {
    switch (p[0]) {
      case "settings":
        return drive.getDriveSettings(ctx.workspaceId);
      case "summary":
        return drive.getDriveSummary(ctx.workspaceId, opts);
      case "export":
        return (await import("./documents")).driveCsv(ctx, q);
      case "earnings":
        return page(await drive.listEarnings(ctx.workspaceId, opts), q);
      case "trips":
        return page(await drive.listTrips(ctx.workspaceId, opts), q);
      case "vehicles": {
        const rows = await drive.listVehicles(ctx.workspaceId);
        return page(rows.slice(offset(q), offset(q) + q.limit + 1), q);
      }
      case "expenses":
        return page(
          await drive.listExpenses(ctx.workspaceId, {
            ...opts,
            vehicleId: q.vehicleId ? branded<"VehicleId">(q.vehicleId) : undefined,
            type: q.type ? parse(expenseType, q.type) : undefined,
          }),
          q,
        );
    }
  }
  if (p.length === 2) {
    const value = id(p[1]);
    switch (p[0]) {
      case "earnings":
        return found(await drive.getEarning(ctx.workspaceId, branded<"DriveEarningId">(value)));
      case "trips":
        return found(await drive.getTrip(ctx.workspaceId, branded<"DriveTripId">(value)));
      case "vehicles":
        return found(await drive.getVehicle(ctx.workspaceId, branded<"VehicleId">(value)));
      case "expenses":
        return found(await drive.getExpense(ctx.workspaceId, branded<"DriveExpenseId">(value)));
    }
  }
  missing();
}
export async function writeDrive(
  ctx: Context,
  p: string[],
  method: Method,
  body: unknown,
): Promise<unknown> {
  await gate(ctx, "manage:drive", "drive");
  const { data, expectedVersion } = splitBody(body);
  if (p.length === 1 && p[0] === "settings" && (method === "PATCH" || method === "POST")) {
    const input = parse(
      z
        .object({
          mileageRateCentsPerKm: cents.max(100000).optional(),
          defaultVehicleId: z.uuid().nullable().optional(),
        })
        .strict(),
      data,
    );
    if (input.defaultVehicleId)
      found(await drive.getVehicle(ctx.workspaceId, branded<"VehicleId">(input.defaultVehicleId)));
    await drive.upsertDriveSettings(
      ctx.workspaceId,
      {
        ...input,
        defaultVehicleId: input.defaultVehicleId
          ? branded<"VehicleId">(input.defaultVehicleId)
          : input.defaultVehicleId === null
            ? null
            : undefined,
      },
      ctx.user.id,
    );
    return drive.getDriveSettings(ctx.workspaceId);
  }
  if (p.length === 1 && method === "POST") {
    switch (p[0]) {
      case "earnings": {
        const input = parse(earningSchema, data);
        return createOnce(
          ctx,
          (v) => drive.getEarning(ctx.workspaceId, branded<"DriveEarningId">(v)),
          (v) =>
            drive.createEarning(
              ctx.workspaceId,
              input,
              ctx.user.id,
              v ? branded<"DriveEarningId">(v) : undefined,
            ),
        );
      }
      case "trips": {
        const input = parse(tripSchema, data);
        return createOnce(
          ctx,
          (v) => drive.getTrip(ctx.workspaceId, branded<"DriveTripId">(v)),
          (v) =>
            drive.createTrip(
              ctx.workspaceId,
              {
                ...input,
                vehicleId: input.vehicleId
                  ? branded<"VehicleId">(input.vehicleId)
                  : input.vehicleId === null
                    ? null
                    : undefined,
              },
              ctx.user.id,
              v ? branded<"DriveTripId">(v) : undefined,
            ),
        );
      }
      case "vehicles": {
        const input = parse(vehicleSchema, data);
        return createOnce(
          ctx,
          (v) => drive.getVehicle(ctx.workspaceId, branded<"VehicleId">(v)),
          (v) =>
            drive.createVehicle(
              ctx.workspaceId,
              input,
              ctx.user.id,
              v ? branded<"VehicleId">(v) : undefined,
            ),
        );
      }
      case "expenses": {
        const input = parse(expenseSchema, data);
        if (input.receiptFileId) {
          await gate(ctx, "view:file");
          found(await getFile(ctx.workspaceId, branded<"FileId">(input.receiptFileId)));
          await (await import("./files")).assertFileComplete(ctx, input.receiptFileId);
        }
        return createOnce(
          ctx,
          (v) => drive.getExpense(ctx.workspaceId, branded<"DriveExpenseId">(v)),
          (v) =>
            drive.createExpense(
              ctx.workspaceId,
              {
                ...input,
                vehicleId: branded<"VehicleId">(input.vehicleId),
                receiptFileId: input.receiptFileId
                  ? branded<"FileId">(input.receiptFileId)
                  : input.receiptFileId === null
                    ? null
                    : undefined,
              },
              ctx.user.id,
              v ? branded<"DriveExpenseId">(v) : undefined,
            ),
        );
      }
    }
  }
  if (p.length !== 2) return missing();
  const value = id(p[1]);
  switch (p[0]) {
    case "earnings": {
      const key = branded<"DriveEarningId">(value);
      checkVersion(found(await drive.getEarning(ctx.workspaceId, key)), expectedVersion);
      if (method === "PATCH")
        await drive.updateEarning(
          ctx.workspaceId,
          key,
          parse(earningSchema.partial(), data),
          ctx.user.id,
          expectedVersion,
        );
      else if (method === "DELETE") {
        parse(z.object({}).strict(), data);
        found((await drive.deleteEarning(ctx.workspaceId, key, ctx.user.id)) || null);
        return { deleted: true };
      } else return missing();
      return found(await drive.getEarning(ctx.workspaceId, key));
    }
    case "trips": {
      const key = branded<"DriveTripId">(value);
      checkVersion(found(await drive.getTrip(ctx.workspaceId, key)), expectedVersion);
      if (method === "PATCH") {
        const input = parse(tripSchema.partial(), data);
        await drive.updateTrip(
          ctx.workspaceId,
          key,
          {
            ...input,
            vehicleId: input.vehicleId
              ? branded<"VehicleId">(input.vehicleId)
              : input.vehicleId === null
                ? null
                : undefined,
          },
          ctx.user.id,
          expectedVersion,
        );
      } else if (method === "DELETE") {
        parse(z.object({}).strict(), data);
        found((await drive.deleteTrip(ctx.workspaceId, key, ctx.user.id)) || null);
        return { deleted: true };
      } else return missing();
      return found(await drive.getTrip(ctx.workspaceId, key));
    }
    case "vehicles": {
      const key = branded<"VehicleId">(value);
      checkVersion(found(await drive.getVehicle(ctx.workspaceId, key)), expectedVersion);
      if (method === "PATCH")
        await drive.updateVehicle(
          ctx.workspaceId,
          key,
          parse(vehicleSchema.partial(), data),
          ctx.user.id,
          expectedVersion,
        );
      else if (method === "DELETE") {
        parse(z.object({}).strict(), data);
        found((await drive.deleteVehicle(ctx.workspaceId, key, ctx.user.id)) || null);
        return { deleted: true };
      } else return missing();
      return found(await drive.getVehicle(ctx.workspaceId, key));
    }
    case "expenses": {
      const key = branded<"DriveExpenseId">(value);
      checkVersion(found(await drive.getExpense(ctx.workspaceId, key)), expectedVersion);
      if (method === "PATCH") {
        const input = parse(expenseSchema.omit({ vehicleId: true }).partial(), data);
        if (input.receiptFileId) {
          await gate(ctx, "view:file");
          found(await getFile(ctx.workspaceId, branded<"FileId">(input.receiptFileId)));
          await (await import("./files")).assertFileComplete(ctx, input.receiptFileId);
        }
        await drive.updateExpense(
          ctx.workspaceId,
          key,
          {
            ...input,
            receiptFileId: input.receiptFileId
              ? branded<"FileId">(input.receiptFileId)
              : input.receiptFileId === null
                ? null
                : undefined,
          },
          ctx.user.id,
          expectedVersion,
        );
      } else if (method === "DELETE") {
        parse(z.object({}).strict(), data);
        found((await drive.deleteExpense(ctx.workspaceId, key, ctx.user.id)) || null);
        return { deleted: true };
      } else return missing();
      return found(await drive.getExpense(ctx.workspaceId, key));
    }
  }
  missing();
}
