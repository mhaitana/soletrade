"use server";

import { requireWorkspaceContext } from "@/platform/context";
import { listActivity, type ActivityListOptions, type ActivityPage } from "@/platform/activity";

/**
 * Read-side loaders for the activity feed. Called from server components
 * (dashboard, /activity page). All scoping comes from the session-derived
 * workspace — a client-provided workspaceId is never trusted.
 */
export async function loadRecentActivity(limit = 5): Promise<ActivityPage> {
  const ctx = await requireWorkspaceContext();
  return listActivity(ctx.workspaceId, { limit });
}

export async function loadActivityPage(opts: ActivityListOptions = {}): Promise<ActivityPage> {
  const ctx = await requireWorkspaceContext();
  return listActivity(ctx.workspaceId, opts);
}
