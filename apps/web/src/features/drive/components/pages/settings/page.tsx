import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ModuleNotInstalledCard } from "@/components/module-not-installed-card";
import { DriveSettingsForm } from "@/features/drive/components/settings/settings-form";
import { loadDriveSettingsPage } from "@/features/drive/api/settings/actions";

export const metadata = { title: "Drive settings" };

export default async function DriveSettingsPage() {
  const data = await loadDriveSettingsPage();
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="drive" />;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Drive settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure how mileage and expenses are calculated for your workspace.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Mileage & default vehicle</CardTitle>
          <CardDescription>
            The mileage rate is in cents per kilometre and drives the estimated deduction shown on
            the Drive summary. The default vehicle is pre-selected on new expenses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.canManage ? (
            <DriveSettingsForm
              mileageRateCentsPerKm={data.mileageRateCentsPerKm}
              defaultVehicleId={data.defaultVehicleId}
              vehicles={data.vehicles}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              You don&apos;t have permission to change these settings.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/drive/vehicles" className="text-primary hover:underline">
          Manage vehicles
        </Link>
        <Link href="/drive/expenses" className="text-primary hover:underline">
          Vehicle expenses
        </Link>
        <Link href="/drive" className="text-primary hover:underline">
          Back to drive
        </Link>
      </div>
    </div>
  );
}
