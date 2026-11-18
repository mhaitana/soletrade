import "server-only";
import { z } from "zod";
import { getDataClient } from "@/server/infrastructure/db/client";
import { rpc, unwrapMaybe, unwrapVoid } from "@/server/infrastructure/db/helpers";
import type { AiDigestFrequency, WorkspaceRole } from "@/lib/domain/database-enums";
import { branded, type UserId, type WorkspaceId } from "@/types/ids";

/**
 * Briefing digest choices. One row per member per workspace says how often that person
 * wants the digest; no row means off, so nobody receives it without having asked.
 *
 * `last_period` on the same row records the last period a member was picked for. Only
 * `claimDueDigests` moves it forward, inside one database statement, which is what makes a
 * second send in the same period impossible however often the job runs.
 */

/** The member's choice for a workspace; `off` when they have never set one. */
export async function getDigestFrequency(
  workspaceId: WorkspaceId,
  userId: UserId,
): Promise<AiDigestFrequency> {
  const row = await unwrapMaybe(
    getDataClient()
      .from("ai_digest_preferences")
      .select("frequency")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle(),
  );
  return row?.frequency ?? "off";
}

/**
 * Save the member's choice. The caller passes the workspace and user from the signed-in
 * context. Turning the digest off keeps the row, so `last_period` survives and switching
 * it back on the same day cannot cause a second send.
 */
export async function setDigestFrequency(
  workspaceId: WorkspaceId,
  userId: UserId,
  frequency: AiDigestFrequency,
): Promise<void> {
  await unwrapVoid(
    getDataClient().from("ai_digest_preferences").upsert(
      {
        workspace_id: workspaceId,
        user_id: userId,
        frequency,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,user_id" },
    ),
  );
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const claimSchema = z.array(
  z.object({
    workspaceId: z.string().min(1),
    userId: z.string().min(1),
    frequency: z.enum(["daily", "weekly"]),
    period: z.string().regex(LOCAL_DATE),
    previousPeriod: z.string().regex(LOCAL_DATE).nullable(),
    role: z.enum(["owner", "admin", "manager", "accountant", "employee", "readonly"]),
    email: z.string().min(1),
  }),
);

/** One member picked for this period's digest, with what is needed to build and send it. */
export interface DigestClaim {
  workspaceId: WorkspaceId;
  userId: UserId;
  frequency: "daily" | "weekly";
  /** The workspace-local date the claim is for. */
  period: string;
  /** What `last_period` was before the claim, so a claim that sent nothing can be undone. */
  previousPeriod: string | null;
  /** The member's current role, which decides what their digest may contain. */
  role: WorkspaceRole;
  email: string;
}

/**
 * Pick up to `limit` members who are owed a digest at `now` and mark them served, in one
 * statement (see `claim_ai_digests`). Each member is returned by at most one call per
 * period, so overlapping or repeated runs cannot send twice.
 */
export async function claimDueDigests(now: Date, limit: number): Promise<DigestClaim[]> {
  const { data, error } = await rpc(getDataClient(), "claim_ai_digests", {
    p_now: now.toISOString(),
    p_limit: limit,
  });
  if (error) throw new Error(`PostgREST error [${error.code}]: ${error.message}`);
  return claimSchema.parse(data).map((row) => ({
    ...row,
    workspaceId: branded<"WorkspaceId">(row.workspaceId),
    userId: branded<"UserId">(row.userId),
  }));
}

/**
 * Hand a claim back so the next run picks the member up again. Only for a claim that
 * failed before anything was sent. It changes the row only while it still holds this
 * claim's period, so it can never undo a later claim.
 */
export async function releaseDigestClaim(claim: DigestClaim): Promise<void> {
  await unwrapVoid(
    getDataClient()
      .from("ai_digest_preferences")
      .update({ last_period: claim.previousPeriod })
      .eq("workspace_id", claim.workspaceId)
      .eq("user_id", claim.userId)
      .eq("last_period", claim.period),
  );
}
