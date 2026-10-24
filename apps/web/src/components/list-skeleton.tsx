import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Shared route-loading skeleton (Wave 4 robustness). Used by `loading.tsx` boundaries on
 * list-heavy `(app)` routes so the shift from skeleton to content is layout-stable (no CLS).
 * Pure presentational - no app/module/platform imports (shared boundary).
 */
export function ListPageSkeleton({
  titleWidth = "w-40",
  rows = 6,
}: {
  titleWidth?: string;
  rows?: number;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className={`h-7 ${titleWidth}`} />
        <Skeleton className="h-4 w-64" />
      </div>
      <Card>
        <CardContent className="divide-y divide-border p-0">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3 p-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-6 w-20" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
