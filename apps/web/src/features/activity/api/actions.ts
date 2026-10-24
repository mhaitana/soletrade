"use server";

import { requireWorkspaceContext } from "@/server/application/auth/workspace-context";
import { listActivity } from "@/server/foundation/activity/index";
import type { ActivityListOptions, ActivityPage } from "@/lib/domain/activity/types";

/**
 * Read-side loaders for the activity feed. Called from server components
 * (dashboard, /activity page). All scoping comes from the session-derived
 * workspace - a client-provided workspaceId is never trusted.
 */
export async function loadRecentActivity(limit = 5): Promise<ActivityPage> {
  const ctx = await requireWorkspaceContext();
  return listActivity(ctx.workspaceId, { limit });
}

export async function loadActivityPage(opts: ActivityListOptions = {}): Promise<ActivityPage> {
  const ctx = await requireWorkspaceContext();
  return listActivity(ctx.workspaceId, opts);
}
