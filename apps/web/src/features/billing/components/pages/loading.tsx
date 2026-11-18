import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

/** Mirrors the billing page: heading, two summary cards, then the module list. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardContent className="space-y-3 p-6">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-4 w-48 max-w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="divide-y divide-border p-0">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between gap-3 p-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-36" />
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
