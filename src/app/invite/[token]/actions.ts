"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { acceptInvitation } from "@/platform/members";
import { setActiveWorkspaceId } from "@/platform/workspaces";
import { rateLimit } from "@/server/rate-limit";
import { branded } from "@/shared/types/ids";

const tokenSchema = z.object({ token: z.string().min(1) });

export type AcceptInvitationResult = { ok: true } | { ok: false; error: string };

/**
 * Accept a workspace invitation (Wave 4 - public `/invite?token=...`). The signed-in user
 * (resolved from the session, never from client input) accepts the invitation, joins the
 * workspace, and is redirected to its dashboard with the active-workspace cookie set to the
 * joined workspace.
 *
 * Uses `getCurrentUser` (not `requireWorkspaceContext`) because a first-time invitee has no
 * workspace membership yet - `requireWorkspaceContext` would redirect them to /onboarding.
 * The platform `acceptInvitation` enforces the email-match + pending + unexpired guards.
 *
 * Rate-limited per IP (the 122-bit token makes brute-force infeasible, but the gate matches
 * the sibling public actions on `/i/` and `/q/` and blocks automated replay/probing).
 */
export async function acceptInvitationAction(input: unknown): Promise<AcceptInvitationResult> {
  const parsed = tokenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid invitation link." };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  if (!(await rateLimit(`invite:${ip}`, { max: 10, windowMs: 60_000 }))) {
    return { ok: false, error: "Too many attempts. Please try again in a minute." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to accept this invitation." };
  }

  let workspaceId;
  try {
    workspaceId = await acceptInvitation(parsed.data.token, user.id, user.email);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to accept invitation.",
    };
  }

  // Point the active-workspace cookie at the joined workspace so the user lands in it.
  await setActiveWorkspaceId(branded<"WorkspaceId">(workspaceId));
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
