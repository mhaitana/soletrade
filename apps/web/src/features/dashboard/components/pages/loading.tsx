import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * Route loading boundary for `/dashboard` (Phase 9). Next.js shows this while the server
 * component's data loads (the dashboard loader fans out to four module services in parallel).
 * Mirrors the real layout - header + period selector + KPI row + module cards - so the shift
 * from skeleton to content is layout-stable (no CLS).
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6 md:space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-11 w-32 shrink-0" />
      </div>

      {/* KPI row skeleton */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="max-sm:gap-0 max-sm:py-0">
            <CardContent className="space-y-2 p-5 max-sm:flex max-sm:min-h-28 max-sm:flex-col max-sm:justify-between max-sm:p-4">
              <Skeleton className="h-4 w-24 max-w-full" />
              <div className="space-y-2">
                <Skeleton className="h-7 w-24 max-w-full" />
                <Skeleton className="h-3 w-20 max-w-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Module summary cards skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="max-sm:gap-4 max-sm:py-4">
            <CardHeader className="max-sm:px-4">
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent className="space-y-4 max-sm:px-4">
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
