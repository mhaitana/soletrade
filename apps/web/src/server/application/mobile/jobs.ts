import "server-only";
import { getDataClient } from "@/server/infrastructure/db/client";
import { rpc } from "@/server/infrastructure/db/helpers";
import { getStorageAdminClient } from "@/server/infrastructure/storage";
import { env } from "@/server/infrastructure/config/env";

export async function purgeClosedAccounts() {
  const db = getDataClient();
  const { data: jobs, error } = await db
    .from("account_deletion_requests")
    .select("*")
    .eq("status", "pending")
    .lte("purge_after", new Date().toISOString())
    .limit(20);
  if (error) throw new Error("Unable to load account deletion jobs");
  let completed = 0;
  for (const job of jobs ?? []) {
    try {
      if (job.closed_workspace_ids.length) {
        const { data: closed, error: ownershipError } = await db
          .from("workspaces")
          .select("id")
          .in("id", job.closed_workspace_ids)
          .eq("owner_user_id", job.user_id)
          .not("deleted_at", "is", null);
        if (ownershipError) throw new Error("Unable to verify closed-workspace ownership");
        const closedIds = (closed ?? []).map((workspace) => workspace.id);
        // Remove stored file bytes while closed workspaces are inaccessible; retrying
        // this phase is safe. Shared-workspace business files are never selected.
        for (let offset = 0; closedIds.length; offset += 100) {
          const { data: files, error: fileError } = await db
            .from("files")
            .select("storage_path")
            .in("workspace_id", closedIds)
            .order("id")
            .range(offset, offset + 99);
          if (fileError) throw new Error("Unable to enumerate closed-workspace files");
          if (!files?.length) break;
          const result = await getStorageAdminClient()
            .storage.from(env.SUPABASE_STORAGE_BUCKET)
            .remove(files.map((file) => file.storage_path));
          if (result.error) throw new Error("Unable to purge stored files");
          if (files.length < 100) break;
        }
      }
      const { error: purgeError } = await db.rpc("mobile_purge_account", {
        p_user_id: job.user_id,
      });
      if (purgeError) throw new Error("Unable to purge closed account data");
      const auth = await db.auth.admin.deleteUser(job.user_id);
      if (auth.error && auth.error.status !== 404) throw new Error("Unable to purge Auth identity");
      const { error: completionError } = await db
        .from("account_deletion_requests")
        .update({ status: "complete", completed_at: new Date().toISOString() })
        .eq("user_id", job.user_id);
      if (completionError) throw new Error("Unable to finish account deletion job");
      completed++;
    } catch (failure) {
      console.error("Account purge remains pending", {
        userId: job.user_id,
        kind: failure instanceof Error ? failure.name : "unknown",
      });
    }
  }
  return { completed };
}

/**
 * How long a completed mobile write keeps its idempotency record. A device that retries a
 * request inside this window gets the first result back instead of the write happening
 * twice; a retry after it would run again. Ninety days is far beyond any realistic offline
 * period for a queued change.
 */
export const MOBILE_OPERATION_RETENTION_DAYS = 90;
/** Records deleted per cron run; the per-minute schedule clears any backlog quickly. */
const PRUNE_BATCH = 1000;

/** Delete one batch of completed idempotency records past the retention window. */
export async function pruneMobileOperations(now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - MOBILE_OPERATION_RETENTION_DAYS * 86_400_000);
  const { data, error } = await rpc(getDataClient(), "prune_mobile_operations", {
    p_before: before.toISOString(),
    p_limit: PRUNE_BATCH,
  });
  if (error) throw new Error("Unable to prune mobile operation records");
  return Number(data ?? 0);
}
