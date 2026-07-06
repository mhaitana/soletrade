import Link from "next/link";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { Button } from "@/shared/ui/button";
import { VehicleForm } from "../vehicle-form";
import { loadVehiclesPage } from "../actions";

export const metadata = { title: "New vehicle" };
export const dynamic = "force-dynamic";

export default async function NewVehiclePage() {
  const data = await loadVehiclesPage();
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="drive" />;
  if (!data.canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to manage vehicles.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New vehicle</h1>
        <p className="text-sm text-muted-foreground">
          Add a vehicle you use for gig work. Expenses and mileage can be logged against it.
        </p>
      </div>
      <VehicleForm mode="create" />
      <Button asChild variant="outline">
        <Link href="/drive/vehicles">Back to vehicles</Link>
      </Button>
    </div>
  );
}
