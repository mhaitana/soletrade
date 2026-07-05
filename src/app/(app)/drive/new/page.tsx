import Link from "next/link";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { Button } from "@/shared/ui/button";
import { DriveEarningForm } from "../drive-earning-form";
import { DriveTripForm } from "../drive-trip-form";
import { loadDrivePage } from "../actions";

export const metadata = { title: "New entry" };

export default async function NewDriveEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const sp = await searchParams;
  const rawType = typeof sp.type === "string" ? sp.type : undefined;
  const type: "earning" | "trip" = rawType === "trip" ? "trip" : "earning";
  const data = await loadDrivePage({ view: type === "trip" ? "trips" : "earnings" });

  if (!data.installed) return <ModuleNotInstalledCard moduleKey="drive" />;
  if (!data.canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to log Drive entries.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {type === "trip" ? "New mileage trip" : "New earning"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {type === "trip"
            ? "Record the distance you drove for a platform."
            : "Record what you earned on a platform."}
        </p>
      </div>

      <div className="flex gap-2" role="group" aria-label="Switch entry type">
        <Button asChild variant={type === "earning" ? "default" : "outline"} size="sm">
          <Link href="/drive/new?type=earning">Earning</Link>
        </Button>
        <Button asChild variant={type === "trip" ? "default" : "outline"} size="sm">
          <Link href="/drive/new?type=trip">Mileage trip</Link>
        </Button>
      </div>

      {type === "trip" ? <DriveTripForm mode="create" /> : <DriveEarningForm mode="create" />}
    </div>
  );
}
