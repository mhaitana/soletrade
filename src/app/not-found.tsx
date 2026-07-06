import Link from "next/link";

/**
 * Root-level 404 fallback (Wave 4 robustness) — for unmatched public/marketing URLs outside the
 * `(app)` shell. Minimal: no chrome, just a centered message + link home.
 */
export default function RootNotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 text-center">
      <div className="max-w-md space-y-3">
        <p className="font-mono text-sm font-semibold tracking-tight">soletrade labs</p>
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
        <p className="pt-2">
          <Link href="/" className="text-sm text-primary hover:underline">
            Go home →
          </Link>
        </p>
      </div>
    </div>
  );
}
