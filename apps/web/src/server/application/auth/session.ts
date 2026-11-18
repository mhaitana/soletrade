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
async function resolveSessionIdentity(): Promise<SessionUser | null> {
  const supabase = createSupabaseServerClient();
  // getClaims verifies identity but, unlike getUser, normally avoids a remote
  // Auth request when the project uses asymmetric signing keys. The result is
  // memoized below because layouts and pages resolve in parallel and both need
  // the same identity during a render.
  const { data, error } = await supabase.auth.getClaims();
  const subject = data?.claims.sub;
  if (error || !subject) return null;
  const email = data.claims.email;
  return {
    id: branded<"UserId">(subject),
    email: typeof email === "string" ? email : "",
  };
}

/**
 * The verified token's identity, before the account-deleted check. Only for starting
 * reads that `getCurrentUser` must still gate: a caller may fetch data for this id in
 * parallel with that check, but must discard it when `getCurrentUser` returns null.
 */
export const getSessionIdentity = cache(resolveSessionIdentity);

async function resolveCurrentUser(): Promise<SessionUser | null> {
  const identity = await getSessionIdentity();
  if (!identity) return null;
  const { data: profile, error: profileError } = await getDataClient()
    .from("users")
    .select("deleted_at")
    .eq("id", identity.id)
    .maybeSingle();
  if (profileError || profile?.deleted_at) return null;
  return identity;
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
