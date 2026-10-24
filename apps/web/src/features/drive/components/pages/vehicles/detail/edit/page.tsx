import Link from "next/link";
import { ModuleNotInstalledCard } from "@/components/module-not-installed-card";
import { Button } from "@/components/ui/button";
import { VehicleForm } from "@/features/drive/components/vehicles/vehicle-form";
import { VehicleDeleteButton } from "@/features/drive/components/vehicles/vehicle-delete-button";
import { loadVehicleForEdit } from "@/features/drive/api/vehicles/actions";

export const metadata = { title: "Edit vehicle" };

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadVehicleForEdit(id);
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="drive" />;
  if (!data.canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to edit vehicles.
      </p>
    );
  }
  if (!data.vehicle) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Vehicle not found.</p>
        <Button asChild variant="outline">
          <Link href="/drive/vehicles">Back to vehicles</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit vehicle</h1>
        <p className="text-sm text-muted-foreground">Update the details of this vehicle.</p>
      </div>
      <VehicleForm mode="edit" vehicle={data.vehicle} />
      <div className="border-t border-border pt-4">
        <VehicleDeleteButton id={data.vehicle.id} />
      </div>
    </div>
  );
}
