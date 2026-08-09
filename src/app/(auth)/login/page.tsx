import { Logo } from "@/shared/components/logo";
import { LoginForm } from "./login-form";

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
    <div className="mx-auto max-w-sm rounded-lg border border-border bg-card p-8">
      <div className="flex flex-col items-center text-center">
        <Logo href={null} />
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
