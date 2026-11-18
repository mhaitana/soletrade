import Link from "next/link";
import { getCurrentUser } from "@/server/application/auth/session";
import { getInvitationByToken } from "@/server/foundation/members/index";
import type { PublicInvitation } from "@/lib/domain/members/types";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/utils/format-date";
import { InviteAcceptForm } from "@/features/members/components/invite/invite-accept-form";
import { switchInviteAccountAction } from "@/features/members/api/invite/actions";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await getInvitationByToken(token);
  if (!inv) return { title: "Invitation", robots: { index: false, follow: false } };
  return { title: `Join ${inv.workspaceName}`, robots: { index: false, follow: false } };
}

function roleLabel(role: string): string {
  const r = role.charAt(0).toUpperCase() + role.slice(1);
  return r === "Readonly" ? "Read-only" : r;
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await getInvitationByToken(token);
  const user = await getCurrentUser();

  // Unknown token, or no longer pending, or expired → unified "not available" state.
  // `inv.expired` is computed server-side (in the platform) so this component doesn't call
  // `Date.now()` during render (react-hooks/purity rule).
  const unavailable = !inv || inv.status !== "pending" || inv.expired;

  // Return path after sign-in / sign-up: the path-based accept route (this page).
  const nextParam = `/invite/${encodeURIComponent(token)}`;

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-md px-4 py-6 sm:py-10">
        <header className="mb-6">
          <Logo variant="full" href={null} />
        </header>

        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          {unavailable ? (
            <div className="space-y-3">
              <h1 className="text-xl font-semibold">This invitation is no longer available</h1>
              <p className="text-sm text-muted-foreground">
                The link may have expired, been revoked, or already been used. Ask your workspace
                owner to send you a new invitation.
              </p>
              {user ? (
                <Link href="/dashboard" className="text-sm text-primary hover:underline">
                  Go to your dashboard →
                </Link>
              ) : (
                <Link href="/login" className="text-sm text-primary hover:underline">
                  Sign in →
                </Link>
              )}
            </div>
          ) : (
            <InviteBody inv={inv!} token={token} user={user} nextParam={nextParam} />
          )}
        </div>
      </div>
    </main>
  );
}

function InviteBody({
  inv,
  token,
  user,
  nextParam,
}: {
  inv: PublicInvitation;
  token: string;
  user: { id: string; email: string } | null;
  nextParam: string;
}) {
  const emailMatches = user?.email.toLowerCase() === inv.email;
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Invitation</p>
        <h1 className="text-2xl font-semibold">Join {inv.workspaceName}</h1>
        {inv.inviterName ? (
          <p className="text-sm text-muted-foreground">{inv.inviterName} invited you</p>
        ) : null}
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
        <p className="text-muted-foreground">
          You&apos;ve been invited as{" "}
          <strong className="text-foreground">{roleLabel(inv.role)}</strong> to{" "}
          <strong className="text-foreground">{inv.workspaceName}</strong>.
        </p>
        <p className="mt-1 text-muted-foreground">
          For {inv.email} · expires {formatDate(inv.expiresAt)}
        </p>
      </div>

      {!user ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Sign in or create your account with <strong>{inv.email}</strong> to accept.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild>
              <Link href={`/login?next=${encodeURIComponent(nextParam)}`}>Sign in</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/signup?next=${encodeURIComponent(nextParam)}`}>Create account</Link>
            </Button>
          </div>
        </div>
      ) : emailMatches ? (
        <InviteAcceptForm token={token} />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            You&apos;re signed in as <strong>{user.email}</strong>, but this invitation was sent to{" "}
            <strong>{inv.email}</strong>. Sign out and sign in as the invited email to accept.
          </p>
          {/* A plain link to /login would bounce back to the dashboard while this session
              exists, so sign out first and return here afterwards. */}
          <form action={switchInviteAccountAction.bind(null, token)}>
            <Button type="submit" variant="outline" className="w-full sm:w-auto">
              Sign out and continue as {inv.email}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
