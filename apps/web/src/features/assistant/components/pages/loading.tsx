import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

/** Mirrors the assistant page: conversation list beside the chat card. */
export default function Loading() {
  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="order-2 space-y-3 lg:order-1">
        <Skeleton className="h-5 w-32" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </aside>
      <section className="order-1 flex min-h-[60vh] flex-col lg:order-2">
        <Card className="flex min-h-[60vh] flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Skeleton className="size-5 rounded-full" />
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="flex-1 space-y-4 p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <div className="border-t p-3">
            <Skeleton className="h-10 w-full" />
          </div>
        </Card>
      </section>
    </div>
  );
}
