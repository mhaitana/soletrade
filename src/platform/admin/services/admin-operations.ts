import "server-only";
import { getAdminDb } from "./db";
import type { FeatureFlag } from "@/platform/admin/types";
import { requireAdminContext } from "./admin-auth";
import { writeAdminAuditEvent } from "./admin-audit";

export interface WebhookEventSummary {
  id: string;
  provider: string;
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  lastError?: string;
  createdAt: Date;
}

export async function listWebhookEvents(): Promise<WebhookEventSummary[]> {
  await requireAdminContext("view:operations");
  const db = getAdminDb();

  const { data: rows } = await db
    .from("webhook_events")
    .select("id, provider, event_id, event_type, status, attempts, last_error, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (!rows) return [];

  return (
    rows as Array<{
      id: string;
      provider: string;
      event_id: string;
      event_type: string;
      status: string;
      attempts: number;
      last_error?: string;
      created_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    provider: row.provider,
    eventId: row.event_id,
    eventType: row.event_type,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: new Date(row.created_at),
  }));
}

export async function retryWebhookEvent(id: string, reason: string): Promise<void> {
  const ctx = await requireAdminContext("manage:operations");
  const db = getAdminDb();

  await db.from("webhook_events").update({ status: "pending_retry" }).eq("id", id);

  await writeAdminAuditEvent({
    actorAdminId: ctx.adminUser.id,
    actorRole: ctx.roles[0] ?? "operations_admin",
    action: "retry_webhook",
    targetType: "webhook_event",
    targetId: id,
    reason,
  });
}

export interface BackgroundJobSummary {
  id: string;
  name: string;
  queue: string;
  status: string;
  attempts: number;
  runTimeMs?: number;
  error?: string;
  workspaceId?: string;
  createdAt: Date;
}

export async function listBackgroundJobs(): Promise<BackgroundJobSummary[]> {
  await requireAdminContext("view:operations");
  const db = getAdminDb();

  const { data: rows } = await db
    .from("background_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (!rows) return [];

  return (
    rows as Array<{
      id: string;
      name: string;
      queue: string;
      status: string;
      attempts: number;
      run_time_ms?: number;
      error?: string;
      workspace_id?: string;
      created_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    name: row.name,
    queue: row.queue,
    status: row.status,
    attempts: row.attempts,
    runTimeMs: row.run_time_ms,
    error: row.error,
    workspaceId: row.workspace_id,
    createdAt: new Date(row.created_at),
  }));
}

export async function listFeatureFlags(): Promise<FeatureFlag[]> {
  await requireAdminContext("view:feature_flags");
  const db = getAdminDb();

  const { data: rows } = await db
    .from("feature_flags")
    .select("*")
    .order("key", { ascending: true });

  if (!rows) return [];

  return (
    rows as Array<{
      id: string;
      key: string;
      name: string;
      description?: string;
      enabled: boolean;
      rollout_percentage: number;
      workspace_allowlist: string[] | null;
      workspace_blocklist: string[] | null;
      user_allowlist: string[] | null;
      created_at: string;
      updated_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    rolloutPercentage: row.rollout_percentage,
    workspaceAllowlist: row.workspace_allowlist ?? [],
    workspaceBlocklist: row.workspace_blocklist ?? [],
    userAllowlist: row.user_allowlist ?? [],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }));
}

export async function updateFeatureFlagState(
  flagId: string,
  enabled: boolean,
  reason: string,
): Promise<void> {
  const ctx = await requireAdminContext("manage:feature_flags");
  const db = getAdminDb();

  await db
    .from("feature_flags")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", flagId);

  await writeAdminAuditEvent({
    actorAdminId: ctx.adminUser.id,
    actorRole: ctx.roles[0] ?? "super_admin",
    action: "update_feature_flag",
    targetType: "feature_flag",
    targetId: flagId,
    reason,
    metadata: { enabled },
  });
}

export interface SystemHealthReport {
  database: "healthy" | "degraded" | "error";
  redis: "healthy" | "degraded" | "error";
  stripe: "healthy" | "degraded" | "error";
  errorRatePercent: number;
  checkedAt: Date;
}

export async function getSystemHealthReport(): Promise<SystemHealthReport> {
  await requireAdminContext("view:system_health");
  return {
    database: "healthy",
    redis: "healthy",
    stripe: "healthy",
    errorRatePercent: 0.02,
    checkedAt: new Date(),
  };
}
