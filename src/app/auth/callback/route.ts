import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/shared/lib/supabase/server";
import { safeNext } from "@/shared/lib/safe-redirect";
import { branded } from "@/shared/types/ids";
import { ensureUserMirror } from "@/platform/users";

// Auth callback exchanges the PKCE code for a session — never statically prerendered.
export const dynamic = "force-dynamic";

/**
 * Email-link / OAuth callback. Supabase redirects here with a `code` (PKCE) or a
 * `next` path. We exchange the code for a session, mirror the auth user into
 * public.users, then redirect to a safe `next` or /onboarding.
 *
 * This route lives under `src/app/auth/` (NOT the `(auth)` route group), so it
 * gets no layout — correct for a pure redirect endpoint.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");

  if (!code) {
    // No code to exchange — nothing to do here. Bounce to login.
    redirect("/login");
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    redirect("/login?error=auth");
  }

  // Mirror the auth user into public.users (idempotent) so workspace creation's
  // FK is satisfied regardless of how the session was established.
  await ensureUserMirror({
    id: branded<"UserId">(data.user.id),
    email: data.user.email ?? "",
    fullName: (data.user.user_metadata?.full_name as string | undefined) ?? null,
  });

  redirect(safeNext(next) ?? "/onboarding");
}
