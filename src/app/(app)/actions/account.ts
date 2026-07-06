"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceContext } from "@/platform/context";
import { updateUserFullName } from "@/platform/users";

const profileSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required.").max(120, "Name is too long."),
});

export type UpdateProfileResult = { ok: true } | { ok: false; error: string };

/**
 * Update the signed-in user's full name on the `public.users` mirror (Wave 4 — `/settings/account`).
 * No workspace permission gate — a user always edits their own profile. The session resolves the
 * user id (never trusted from client input).
 */
export async function updateProfileAction(input: unknown): Promise<UpdateProfileResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Name is required." };
  }
  const ctx = await requireWorkspaceContext();
  try {
    await updateUserFullName(ctx.user.id, parsed.data.fullName);
    // The account menu + AppShell read the name; revalidate the layout so it refreshes.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update profile." };
  }
}
