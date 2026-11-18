import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

/** Mirrors the assistant page: title and action, then the conversation list beside the chat. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-44" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start xl:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="order-2 overflow-hidden rounded-2xl border border-border bg-card shadow-xs lg:order-1">
          <div className="border-b border-border bg-muted/40 px-4 py-3">
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="divide-y divide-border">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2 px-4 py-3">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </div>
        <Card className="order-1 gap-0 overflow-hidden py-0 lg:order-2 lg:h-[calc(100dvh-12rem)]">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-7 w-28 rounded-full" />
          </div>
          <div className="flex-1 space-y-4 p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <div className="border-t border-border p-3">
            <Skeleton className="h-11 w-full" />
          </div>
        </Card>
      </div>
    </div>
  );
}
