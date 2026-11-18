import Link from "next/link";
import { ModuleNotInstalledCard } from "@/components/module-not-installed-card";
import { Button } from "@/components/ui/button";
import { DriveEarningForm } from "@/features/drive/components/drive-earning-form";
import { DriveEarningsForm } from "@/features/drive/components/drive-earnings-form";
import { DriveTripForm } from "@/features/drive/components/drive-trip-form";
import { loadDriveEntryForm } from "@/features/drive/api/actions";

export const metadata = { title: "New entry" };

export default async function NewDriveEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const sp = await searchParams;
  const rawType = typeof sp.type === "string" ? sp.type : undefined;
  const type = rawType === "trip" || rawType === "earnings" ? rawType : "earning";
  const data = await loadDriveEntryForm();

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
          {type === "trip"
            ? "New mileage trip"
            : type === "earnings"
              ? "New earnings"
              : "New earning"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {type === "trip"
            ? "Record the distance you drove for a platform."
            : type === "earnings"
              ? "Record several days of earnings and save them together."
              : "Record what you earned on a platform."}
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Switch entry type">
        <Button asChild variant={type === "earning" ? "default" : "outline"} size="sm">
          <Link href="/drive/new?type=earning">Earning</Link>
        </Button>
        <Button asChild variant={type === "earnings" ? "default" : "outline"} size="sm">
          <Link href="/drive/new?type=earnings">Multiple earnings</Link>
        </Button>
        <Button asChild variant={type === "trip" ? "default" : "outline"} size="sm">
          <Link href="/drive/new?type=trip">Mileage trip</Link>
        </Button>
      </div>

      {type === "trip" ? (
        <DriveTripForm mode="create" />
      ) : type === "earnings" ? (
        <DriveEarningsForm
          defaultCurrency={data.defaultCurrency}
          initialDate={new Date().toISOString().slice(0, 10)}
        />
      ) : (
        <DriveEarningForm mode="create" defaultCurrency={data.defaultCurrency} />
      )}
    </div>
  );
}
