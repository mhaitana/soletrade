import { Skeleton } from "@/shared/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";

/**
 * Route loading boundary for `/dashboard` (Phase 9). Next.js shows this while the server
 * component's data loads (the dashboard loader fans out to four module services in parallel).
 * Mirrors the real layout — header + period selector + KPI row + module cards — so the shift
 * from skeleton to content is layout-stable (no CLS).
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* Period selector skeleton */}
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
      </div>

      {/* KPI row skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-2 p-5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Module summary cards skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 3 }).map((_, j) => (
                  <Skeleton key={j} className="h-8 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
