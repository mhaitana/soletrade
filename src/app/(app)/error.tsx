"use client";

import { useEffect } from "react";
import { Button } from "@/shared/ui/button";

/**
 * Global error boundary for the `(app)` shell (Wave 4 robustness). Catches render errors
 * thrown by any authed/workspace-scoped route and offers a "Try again" that re-runs the
 * segment (`reset()` from next/error). Server-component data failures above this boundary
 * (e.g. `requireWorkspaceContext` redirects) are not caught here - those propagate as
 * normal navigation. The error is logged to the console in dev only (never in prod, where
 * it could leak details to the rendered output).
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("App route error:", error);
    }
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          An unexpected error occurred while loading this page. You can try again, or head back to
          your dashboard.
        </p>
        {process.env.NODE_ENV !== "production" && error?.message ? (
          <p className="rounded-md border border-border bg-muted/40 p-3 text-left font-mono text-xs text-muted-foreground">
            {error.message}
          </p>
        ) : null}
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button onClick={() => reset()}>Try again</Button>
          <Button variant="outline" onClick={() => (window.location.href = "/dashboard")}>
            Go to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
