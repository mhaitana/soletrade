import Link from "next/link";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { Button } from "@/shared/ui/button";
import { DriveTripForm } from "../../../drive-trip-form";
import { DriveDeleteButton } from "../../../drive-detail-actions";
import { loadTripForEdit } from "../../../actions";

export const metadata = { title: "Edit trip" };

export default async function EditTripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadTripForEdit(id);
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="drive" />;
  if (!data.canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to edit Drive trips.
      </p>
    );
  }
  if (!data.trip) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Trip not found.</p>
        <Button asChild variant="outline">
          <Link href="/drive">Back to drive</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit trip</h1>
        <p className="text-sm text-muted-foreground">Update the details of this mileage trip.</p>
      </div>
      <DriveTripForm mode="edit" trip={data.trip} />
      <div className="border-t border-border pt-4">
        <DriveDeleteButton kind="trip" id={data.trip.id} />
      </div>
    </div>
  );
}
