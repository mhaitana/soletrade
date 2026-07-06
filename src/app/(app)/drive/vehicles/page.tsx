import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { formatKm } from "@/modules/drive/calc";
import { loadVehiclesPage } from "./actions";

export const metadata = { title: "Vehicles" };
export const dynamic = "force-dynamic";

export default async function VehiclesPage() {
  const data = await loadVehiclesPage();
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="drive" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vehicles</h1>
          <p className="text-sm text-muted-foreground">
            Track the vehicles you drive for gig work, and log expenses against them.
          </p>
        </div>
        {data.canManage ? (
          <Button asChild>
            <Link href="/drive/vehicles/new">
              <Plus className="size-4" aria-hidden />
              New vehicle
            </Link>
          </Button>
        ) : null}
      </div>

      {data.vehicles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">No vehicles yet.</p>
          {data.canManage ? (
            <p className="mt-1 text-sm">
              <Link href="/drive/vehicles/new" className="text-primary hover:underline">
                Add your first vehicle
              </Link>
            </p>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.vehicles.map((v) => {
            const summary = [v.make, v.model, v.year ? String(v.year) : null]
              .filter(Boolean)
              .join(" ");
            return (
              <Card key={v.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/drive/vehicles/${v.id}/edit`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {v.name}
                      </Link>
                      {summary ? (
                        <p className="truncate text-sm text-muted-foreground">{summary}</p>
                      ) : null}
                    </div>
                    <Badge variant={v.active ? "default" : "secondary"}>
                      {v.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  {v.odometerKm != null ? (
                    <p className="text-sm text-muted-foreground tabular-nums">
                      Odometer: {formatKm(v.odometerKm * 1000)}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/drive/expenses?vehicle=${v.id}`}>Log expense</Link>
                    </Button>
                    {data.canManage ? (
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/drive/vehicles/${v.id}/edit`}>Edit</Link>
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
