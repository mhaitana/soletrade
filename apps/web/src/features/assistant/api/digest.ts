"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceContext } from "@/server/application/auth/workspace-context";
import { getWorkspace } from "@/server/foundation/workspaces/index";
import {
  getDigestFrequency,
  setDigestFrequency,
} from "@/server/foundation/notifications/digest-preferences";
import type { AiDigestFrequency } from "@/lib/domain/database-enums";
import { localDate } from "@/lib/domain/insights/local-date";

/**
 * Server actions for the briefing digest setting under Settings > hAI. The choice belongs
 * to the signed-in member in the active workspace: both ids come from the session
 * (`requireWorkspaceContext`), and the only client input is the frequency. Every member may
 * set their own; nobody can set someone else's.
 */

export interface DigestSettingsData {
  /** The member's saved choice; `off` when they have never chosen. */
  frequency: AiDigestFrequency;
  workspaceName: string;
  /** The timezone the 07:00 send time is measured in (UTC when the workspace's is unknown). */
  timezone: string;
  /** Where the email part of the digest goes. */
  email: string;
}

export async function loadDigestSettings(): Promise<DigestSettingsData> {
  const ctx = await requireWorkspaceContext();
  const [frequency, workspace] = await Promise.all([
    getDigestFrequency(ctx.workspaceId, ctx.user.id),
    getWorkspace(ctx.workspaceId),
  ]);
  return {
    frequency,
    workspaceName: workspace?.name ?? "this workspace",
    timezone: localDate(new Date(), workspace?.timezone).timezone,
    email: ctx.user.email,
  };
}

const digestSchema = z.object({ frequency: z.enum(["off", "daily", "weekly"]) });

export type SetDigestFrequencyResult =
  { ok: true; frequency: AiDigestFrequency } | { ok: false; error: string };

export async function setDigestFrequencyAction(input: unknown): Promise<SetDigestFrequencyResult> {
  const parsed = digestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose Off, Daily or Weekly." };

  const ctx = await requireWorkspaceContext();
  try {
    await setDigestFrequency(ctx.workspaceId, ctx.user.id, parsed.data.frequency);
  } catch (error) {
    console.error("[assistant.digest] could not save preference", error);
    return { ok: false, error: "Your choice could not be saved. Try again." };
  }
  revalidatePath("/settings/assistant");
  return { ok: true, frequency: parsed.data.frequency };
}
