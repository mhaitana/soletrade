import Link from "next/link";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { Button } from "@/shared/ui/button";
import { DriveEarningForm } from "../../../drive-earning-form";
import { DriveDeleteButton } from "../../../drive-detail-actions";
import { loadEarningForEdit } from "../../../actions";

export const metadata = { title: "Edit earning" };

export default async function EditEarningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadEarningForEdit(id);
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="drive" />;
  if (!data.canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to edit Drive earnings.
      </p>
    );
  }
  if (!data.earning) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Earning not found.</p>
        <Button asChild variant="outline">
          <Link href="/drive">Back to drive</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit earning</h1>
        <p className="text-sm text-muted-foreground">Update the details of this earning.</p>
      </div>
      <DriveEarningForm mode="edit" earning={data.earning} defaultCurrency={data.defaultCurrency} />
      <div className="border-t border-border pt-4">
        <DriveDeleteButton kind="earning" id={data.earning.id} />
      </div>
    </div>
  );
}
