"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ShieldAlert, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Admin route-group error boundary. Surfaces access-denied (AdminAuthorizationError)
 * distinctly from generic errors, so unauthorized staff get a clear message instead
 * of the generic root "Something went wrong". Duck-typed on error.name to avoid
 * importing a server-only module into a client boundary.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { reason?: string; digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("Admin route error:", error);
    }
  }, [error]);

  const isAccessDenied =
    error.name === "AdminAuthorizationError" ||
    error.reason === "unauthorized_admin" ||
    error.reason === "insufficient_permission";

  if (isAccessDenied) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background p-4 text-center">
        <div className="max-w-md space-y-4">
          <div className="mx-auto w-fit rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive">
            <ShieldAlert className="size-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Access denied</h1>
          <p className="text-sm text-muted-foreground">
            Your staff roles don&apos;t include permission for this area. If you believe this is an
            error, ask a super admin to review your role assignment.
          </p>
          <div className="flex justify-center gap-2 pt-1">
            <Button asChild variant="outline">
              <Link href="/admin">Back to admin dashboard</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background p-4 text-center">
      <div className="max-w-md space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          An unexpected error occurred while loading this admin page.
        </p>
        <p className="pt-2">
          <Button variant="outline" onClick={() => reset()}>
            <RotateCcw className="size-4" />
            Try again
          </Button>
        </p>
      </div>
    </div>
  );
}
