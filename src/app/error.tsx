"use client";

import { useEffect } from "react";

/**
 * Root error boundary (Wave 4 robustness) — last-resort fallback for public/marketing routes
 * outside the `(app)` shell. Minimal chrome; logs only in dev.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("Root route error:", error);
    }
  }, [error]);

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 text-center">
      <div className="max-w-md space-y-3">
        <p className="font-mono text-sm font-semibold tracking-tight">soletrade labs</p>
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          An unexpected error occurred. Please try again.
        </p>
        <p className="pt-2">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-sm text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          >
            Try again →
          </button>
        </p>
      </div>
    </div>
  );
}
