import { Logo } from "@/components/logo";
import { LoginForm } from "@/features/auth/components/login/login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : null;
  const error = sp.error === "auth" ? "The sign-in link was invalid or expired." : null;

  return (
    <div className="mx-auto max-w-sm rounded-2xl border border-border/80 bg-card p-8 sm:p-10 shadow-xs">
      <div className="flex flex-col items-center text-center">
        <Logo href={null} className="text-lg" />
        <h1 className="mt-6 text-xl font-semibold">Sign in to your workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter your credentials, or use a magic link.
        </p>
      </div>
      {error ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-6">
        <LoginForm next={next} />
      </div>
    </div>
  );
}
