import type { SessionUser } from "@/lib/domain/auth/session-types";
export type { SessionUser } from "@/lib/domain/auth/session-types";
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/server/infrastructure/supabase/server";
import { branded } from "@/types/ids";
import { getDataClient } from "@/server/infrastructure/db/client";

/**
 * Resolve the authenticated user from the request session, or `null` if there
 * isn't one. Use this on public pages that adapt to signed-in state. Mutations
 * must use `requireUser` instead.
 */
async function resolveCurrentUser(): Promise<SessionUser | null> {
  const supabase = createSupabaseServerClient();
  // getClaims verifies identity but, unlike getUser, normally avoids a remote
  // Auth request when the project uses asymmetric signing keys. The result is
  // memoized below because layouts and pages resolve in parallel and both need
  // the same identity during a render.
  const { data, error } = await supabase.auth.getClaims();
  const subject = data?.claims.sub;
  if (error || !subject) return null;
  const { data: profile, error: profileError } = await getDataClient()
    .from("users")
    .select("deleted_at")
    .eq("id", subject)
    .maybeSingle();
  if (profileError || profile?.deleted_at) return null;
  const email = data.claims.email;
  return {
    id: branded<"UserId">(subject),
    email: typeof email === "string" ? email : "",
  };
}

export const getCurrentUser = cache(resolveCurrentUser);

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
