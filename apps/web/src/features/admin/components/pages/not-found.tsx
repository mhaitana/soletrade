import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function AdminNotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-4 text-center">
      <div className="max-w-md space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Resource not found</h1>
        <p className="text-sm text-muted-foreground">
          This admin resource doesn&apos;t exist or has been removed.
        </p>
        <p className="pt-2">
          <Button asChild variant="outline">
            <Link href="/admin">Back to admin dashboard</Link>
          </Button>
        </p>
      </div>
    </div>
  );
}
