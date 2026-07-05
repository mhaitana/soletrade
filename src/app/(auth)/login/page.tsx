import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { Logo } from "@/shared/components/logo";

export default function LoginPage() {
  return (
    <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
      <div className="flex flex-col items-center text-center">
        <Logo href={null} />
        <h1 className="mt-6 text-xl font-semibold">Sign in to your workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Authentication is wired up in Phase 1. For now, continue into the demo app.
        </p>
      </div>
      <Button asChild className="mt-6 w-full">
        <Link href="/dashboard">Continue</Link>
      </Button>
    </div>
  );
}
