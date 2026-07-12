import Link from "next/link";
import { Logo } from "@/shared/components/logo";

/**
 * Root-level 404 fallback (Wave 4 robustness) - for unmatched public/marketing URLs outside the
 * `(app)` shell. Minimal: no chrome, just a centered message + link home.
 */
export default function RootNotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 text-center">
      <div className="max-w-md space-y-3">
        <Logo variant="full" href={null} />
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
        <p className="pt-2">
          <Link
            href="/"
            className="rounded-sm text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          >
            Go home →
          </Link>
        </p>
      </div>
    </div>
  );
}
