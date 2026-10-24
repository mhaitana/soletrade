"use server";

import { setActiveWorkspaceId } from "@/server/application/auth/workspace-cookie";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/application/auth/session";
import { createWorkspace, listUserWorkspaces } from "@/server/foundation/workspaces/index";
import { ensureUserMirror } from "@/server/foundation/users/index";

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80, "Name is too long."),
  slug: z
    .string()
    .trim()
    .min(2, "Slug must be at least 2 characters.")
    .max(40, "Slug is too long.")
    .regex(/^[a-z0-9-]+$/, "Slug may only contain lowercase letters, numbers, and hyphens."),
});

export type CreateWorkspaceResult =
  | { ok: true; workspaceId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Create a new workspace. Callable by any signed-in user (the creator becomes
 * owner); this is the onboarding action and is therefore NOT workspace-scoped.
 */
export async function createWorkspaceAction(input: unknown): Promise<CreateWorkspaceResult> {
  const parsed = createWorkspaceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const user = await requireUser();
  try {
    // Defensive mirror: guarantee the public.users row exists before the FK on
    // workspaces.owner_user_id can reference it, regardless of how the session
    // was established (signup, magic link, or a stale cookie from Phase 1).
    await ensureUserMirror({ id: user.id, email: user.email });
    const id = await createWorkspace(user.id, parsed.data.name, parsed.data.slug);
    await setActiveWorkspaceId(id);
    revalidatePath("/", "layout");
    return { ok: true, workspaceId: id };
  } catch (err) {
    // PostgREST surfaces Postgres errors with the real message on `.message`
    // (e.g. "duplicate key value violates unique constraint …"); supabase-js
    // may also nest it on `.cause.message`. Read both so slug-taken detection
    // matches the "duplicate"/"unique" wording regardless of the wrapper.
    const causeMessage = (err as { cause?: { message?: string } })?.cause?.message;
    const message =
      (err instanceof Error ? (causeMessage ?? err.message) : "Failed to create workspace.") ??
      "Failed to create workspace.";
    return {
      ok: false,
      error: /unique|duplicate/i.test(message) ? "That slug is taken." : message,
    };
  }
}

const switchWorkspaceSchema = z.object({ workspaceId: z.string().uuid() });

export type SwitchWorkspaceResult = { ok: true } | { ok: false; error: string };

/**
 * Switch the active workspace. Verifies membership server-side - the
 * client-supplied workspace id is only ever used as a candidate, never trusted.
 */
export async function switchWorkspaceAction(input: unknown): Promise<SwitchWorkspaceResult> {
  const parsed = switchWorkspaceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid workspace." };

  const user = await requireUser();
  const memberships = await listUserWorkspaces(user.id);
  const target = memberships.find((m) => m.workspaceId === parsed.data.workspaceId);
  if (!target) {
    // IDOR guard: client sent a workspace id the user isn't a member of.
    return { ok: false, error: "You don't have access to that workspace." };
  }
  await setActiveWorkspaceId(target.workspaceId);
  revalidatePath("/", "layout");
  return { ok: true };
}
