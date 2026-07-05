import { Logo } from "@/shared/components/logo";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Create your account" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ checkEmail?: string | string[] }>;
}) {
  const sp = await searchParams;
  const initialCheckEmail = sp.checkEmail === "1";

  return (
    <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
      <div className="flex flex-col items-center text-center">
        <Logo href={null} />
        <h1 className="mt-6 text-xl font-semibold">Create your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Start your workspace in a minute. No card required.
        </p>
      </div>
      <div className="mt-6">
        <SignupForm initialCheckEmail={initialCheckEmail} />
      </div>
    </div>
  );
}
