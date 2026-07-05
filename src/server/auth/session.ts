import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/shared/lib/supabase/server";
import { branded, type UserId } from "@/shared/types/ids";

export interface SessionUser {
  id: UserId;
  email: string;
}

/**
 * Resolve the authenticated user from the request session, or `null` if there
 * isn't one. Use this on public pages that adapt to signed-in state. Mutations
 * must use `requireUser` instead.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return {
    id: branded<"UserId">(user.id),
    email: user.email ?? "",
  };
}

/**
 * Require an authenticated user; otherwise redirect to /login with the
 * attempted path preserved in `next`. Always returns a non-null user.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}
