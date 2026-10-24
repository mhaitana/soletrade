import { z } from "zod";
import { can, type Permission } from "@/platform/permissions";
import { isModuleEnabled } from "@/platform/module-installations";
import type { ModuleKey } from "@/shared/constants/modules";
import { MobileApiError, type MobileWorkspaceContext } from "@/platform/mobile/http";
export type Context = MobileWorkspaceContext;
export type Method = "POST" | "PATCH" | "DELETE";
export const uuid = z.uuid();
export const text = z.string().trim().min(1).max(280);
export const notes = z.string().trim().max(2000).nullable().optional();
export const cents = z.number().int().min(0).max(2_147_483_647);
export const currency = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .optional();
export const date = z
  .union([z.iso.datetime({ offset: true }), z.iso.date()])
  .transform((v) => new Date(v))
  .refine(
    (v) => v.getUTCFullYear() >= 1900 && v.getUTCFullYear() <= 2200,
    "Date outside supported range",
  );
export const versionSchema = z.iso.datetime({ offset: true }).optional();
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new MobileApiError(
      "invalid_request",
      r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      400,
    );
  return r.data;
}
export function id(value: unknown): string {
  return parse(uuid, value);
}
export function missing(): never {
  throw new MobileApiError("not_found", "Resource not found.", 404);
}
export function found<T>(row: T | null | undefined): T {
  if (!row) missing();
  return row;
}
export function conflict(message: string): never {
  throw new MobileApiError("conflict", message, 409);
}
export async function gate(ctx: Context, permission: Permission, module?: ModuleKey) {
  if (!can(ctx.role, permission))
    throw new MobileApiError("forbidden", "Your role does not allow this action.", 403);
  if (module && !(await isModuleEnabled(ctx.workspaceId, module)))
    throw new MobileApiError("module_unavailable", "This module is not enabled.", 404);
}
export function checkVersion(row: { updatedAt: Date | string }, expected?: string) {
  if (expected && new Date(row.updatedAt).getTime() !== new Date(expected).getTime())
    conflict("This record changed. Refresh before saving.");
}
export function splitBody(body: unknown) {
  const r = parse(z.object({ expectedVersion: versionSchema }).passthrough(), body ?? {});
  const { expectedVersion, ...data } = r;
  return { expectedVersion, data };
}
export const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(2000).optional(),
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().min(1).max(50).optional(),
  dateFrom: date.optional(),
  dateTo: date.optional(),
  customerId: uuid.optional(),
  vehicleId: uuid.optional(),
  platform: z.string().max(50).optional(),
  type: z.string().max(100).optional(),
  status: z.string().max(30).optional(),
  period: z.enum(["week", "month", "quarter", "year", "calendar", "all"]).optional(),
  entityType: z.string().max(50).optional(),
  entityId: uuid.optional(),
  q: z.string().trim().min(2).max(100).optional(),
  unreadOnly: z.enum(["true", "false"]).optional(),
  actionPrefix: z.string().max(100).optional(),
  targetType: z.string().max(50).optional(),
});
export function query(q: URLSearchParams) {
  const v = parse(querySchema, Object.fromEntries(q));
  if (v.dateFrom && v.dateTo && v.dateFrom > v.dateTo)
    throw new MobileApiError("invalid_request", "dateFrom must precede dateTo.", 400);
  return v;
}
export type Query = ReturnType<typeof query>;
export function offset(q: Query) {
  return q.cursor ? parse(z.coerce.number().int().min(0).max(1_000_000), q.cursor) : 0;
}
export function page<T>(rows: T[], q: Query) {
  return {
    items: rows.slice(0, q.limit),
    nextCursor: rows.length > q.limit ? String(offset(q) + q.limit) : null,
  };
}
export function keyset(q: Query): { createdAt: string; id: string } | undefined {
  if (!q.cursor) return undefined;
  try {
    return parse(
      z.object({ createdAt: z.iso.datetime({ offset: true }), id: uuid }).strict(),
      JSON.parse(Buffer.from(q.cursor, "base64url").toString("utf8")),
    );
  } catch {
    throw new MobileApiError("invalid_cursor", "Invalid pagination cursor.", 400);
  }
}
export function keysetPage<T>(p: { items: T[]; nextCursor: unknown }) {
  return {
    items: p.items,
    nextCursor: p.nextCursor
      ? Buffer.from(JSON.stringify(p.nextCursor)).toString("base64url")
      : null,
  };
}
export async function createOnce<T>(
  ctx: Context,
  get: (id: string) => Promise<T | null>,
  create: (id?: string) => Promise<string>,
): Promise<T> {
  const operationId = ctx.operationId ? id(ctx.operationId) : undefined;
  if (operationId) {
    const existing = await get(operationId);
    if (existing) return existing;
  }
  try {
    return found(await get(await create(operationId)));
  } catch (err) {
    if (operationId) {
      const existing = await get(operationId);
      if (existing) return existing;
    }
    throw err;
  }
}
