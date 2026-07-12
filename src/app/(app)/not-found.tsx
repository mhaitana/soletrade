import Link from "next/link";
import { Button } from "@/shared/ui/button";

/**
 * 404 for unmatched `(app)` routes (Wave 4 robustness) - e.g. a deleted customer/invoice whose
 * page resolved to null and threw a `notFound()`, or a mistyped app URL. Keeps the app shell
 * (sidebar etc.) since this renders inside the `(app)` layout.
 */
export default function AppNotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t find what you were looking for. It may have been moved or deleted.
        </p>
        <div className="pt-2">
          <Button asChild>
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
