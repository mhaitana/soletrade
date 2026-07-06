import Link from "next/link";
import { Plus, Search, Download } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Badge } from "@/shared/ui/badge";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { formatCents } from "@/platform/billing/pricing";
import { formatDate } from "@/shared/utils/format-date";
import { DRIVE_PLATFORMS, platformLabel } from "@/shared/constants/drive-platforms";
import { formatKm } from "@/modules/drive/calc";
import { PERIODS, parsePeriod, type Period } from "@/shared/utils/periods";
import { loadDrivePage, type DriveView } from "./actions";
import { DriveSummary } from "./drive-summary";
import { SwipeQuickLog } from "./swipe-quick-log";

const EXPORT_TYPES: { key: "earnings" | "trips" | "expenses"; label: string }[] = [
  { key: "earnings", label: "Earnings CSV" },
  { key: "trips", label: "Mileage CSV" },
  { key: "expenses", label: "Expenses CSV" },
];

export const metadata = { title: "Drive" };

const VIEW_FILTERS: { key: DriveView; label: string }[] = [
  { key: "earnings", label: "Earnings" },
  { key: "trips", label: "Mileage" },
];

/** Build a `/drive` href preserving the active view + period + platform + search across links. */
function hrefWith(
  patch: { view?: DriveView; platform?: string | null; period?: Period },
  current: {
    view: DriveView;
    platform: string | null;
    search: string;
    period: Period;
  },
): string {
  const params = new URLSearchParams();
  const nextView = patch.view ?? current.view;
  if (nextView !== "earnings") params.set("view", nextView);
  const nextPlatform = patch.platform !== undefined ? patch.platform : current.platform;
  if (nextPlatform) params.set("platform", nextPlatform);
  if (current.search) params.set("search", current.search);
  if (patch.period) {
    if (patch.period !== "year") params.set("period", patch.period);
  } else if (current.period !== "year") {
    params.set("period", current.period);
  }
  const qs = params.toString();
  return qs ? `/drive?${qs}` : "/drive";
}

export default async function DrivePage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string | string[];
    platform?: string | string[];
    search?: string | string[];
    period?: string | string[];
  }>;
}) {
  const sp = await searchParams;
  const rawView = typeof sp.view === "string" ? sp.view : undefined;
  const rawPlatform = typeof sp.platform === "string" ? sp.platform : undefined;
  const rawSearch = typeof sp.search === "string" ? sp.search : undefined;
  const rawPeriod = typeof sp.period === "string" ? sp.period : undefined;
  const view: DriveView = rawView === "trips" ? "trips" : "earnings";
  const platform =
    rawPlatform && DRIVE_PLATFORMS.some((p) => p.key === rawPlatform) ? rawPlatform : undefined;
  const period = parsePeriod(rawPeriod);
  const data = await loadDrivePage({ view, platform, search: rawSearch, period });

  if (!data.installed) return <ModuleNotInstalledCard moduleKey="drive" />;

  const current = {
    view: data.view,
    platform: data.platformFilter,
    search: data.search,
    period: data.period,
  };
  const list = data.view === "trips" ? data.trips : data.earnings;
  const hasFilters = Boolean(
    data.search || data.platformFilter || data.view !== "earnings" || data.period !== "year",
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Drive</h1>
          <p className="text-sm text-muted-foreground">Log gig earnings and mileage.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.canManage ? (
            <>
              <div
                className="flex flex-wrap items-center gap-1.5"
                role="group"
                aria-label="Export Drive data as CSV"
              >
                {EXPORT_TYPES.map((t) => (
                  <Button asChild key={t.key} variant="outline" size="sm">
                    <a href={`/api/drive/export?type=${t.key}&period=${data.period}`} download>
                      <Download className="size-3.5" aria-hidden />
                      {t.label}
                    </a>
                  </Button>
                ))}
              </div>
              <Button asChild>
                <Link href={`/drive/new?type=${data.view === "trips" ? "trip" : "earning"}`}>
                  <Plus className="size-4" aria-hidden />
                  {data.view === "trips" ? "New trip" : "New earning"}
                </Link>
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <nav className="flex flex-wrap items-center gap-4 text-sm" aria-label="Drive sections">
        <Link href="/drive/vehicles" className="text-muted-foreground hover:underline">
          Vehicles
        </Link>
        <Link href="/drive/expenses" className="text-muted-foreground hover:underline">
          Expenses
        </Link>
        <Link href="/drive/settings" className="text-muted-foreground hover:underline">
          Settings
        </Link>
      </nav>

      <div className="flex flex-wrap items-center gap-4" aria-label="Filters">
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Switch between earnings and mileage"
        >
          {VIEW_FILTERS.map((f) => {
            const active = f.key === data.view;
            return (
              <Button
                key={f.key}
                asChild
                variant={active ? "default" : "outline"}
                size="sm"
                aria-current={active ? "page" : undefined}
              >
                <Link href={hrefWith({ view: f.key }, current)}>{f.label}</Link>
              </Button>
            );
          })}
        </div>

        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Filter by period"
        >
          {PERIODS.map((p) => {
            const active = p.key === data.period;
            return (
              <Button
                key={p.key}
                asChild
                variant={active ? "default" : "outline"}
                size="sm"
                aria-current={active ? "page" : undefined}
              >
                <Link href={hrefWith({ period: p.key }, current)}>{p.label}</Link>
              </Button>
            );
          })}
        </div>

        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Filter by platform"
        >
          <Button
            asChild
            variant={!data.platformFilter ? "default" : "outline"}
            size="sm"
            aria-current={!data.platformFilter ? "page" : undefined}
          >
            <Link href={hrefWith({ platform: null }, current)}>All platforms</Link>
          </Button>
          {DRIVE_PLATFORMS.map((p) => {
            const active = data.platformFilter === p.key;
            return (
              <Button
                key={p.key}
                asChild
                variant={active ? "default" : "outline"}
                size="sm"
                aria-current={active ? "page" : undefined}
              >
                <Link href={hrefWith({ platform: p.key }, current)}>{p.label}</Link>
              </Button>
            );
          })}
        </div>
      </div>

      <form action="/drive" method="get" className="flex flex-wrap gap-2" role="search">
        <input type="hidden" name="view" value={data.view} />
        {data.platformFilter ? (
          <input type="hidden" name="platform" value={data.platformFilter} />
        ) : null}
        {data.period !== "year" ? <input type="hidden" name="period" value={data.period} /> : null}
        <Input
          type="search"
          name="search"
          defaultValue={data.search}
          placeholder={
            data.view === "trips" ? "Search by purpose or notes" : "Search by description or notes"
          }
          className="max-w-sm"
          aria-label={`Search ${data.view}`}
        />
        <Button type="submit" variant="outline">
          <Search className="size-4" aria-hidden />
          Search
        </Button>
        {hasFilters ? (
          <Button asChild variant="ghost">
            <Link href="/drive">Clear</Link>
          </Button>
        ) : null}
      </form>

      <DriveSummary summary={data.summary} currency="AUD" period={data.period} />

      {data.canManage ? <SwipeQuickLog /> : null}

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {data.search || data.platformFilter
              ? `No ${data.view === "trips" ? "trips" : "earnings"} match your filters.`
              : data.view === "trips"
                ? "No mileage trips yet."
                : "No earnings yet."}
          </p>
          {data.canManage && !data.search && !data.platformFilter ? (
            <p className="mt-1 text-sm">
              <Link
                href={`/drive/new?type=${data.view === "trips" ? "trip" : "earning"}`}
                className="text-primary hover:underline"
              >
                {data.view === "trips" ? "Log your first trip" : "Log your first earning"}
              </Link>
            </p>
          ) : null}
        </div>
      ) : data.view === "trips" ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Date
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Platform
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Purpose
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Distance
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.trips.map((t) => {
                const label = platformLabel(t.platform) ?? t.platform;
                return (
                  <tr key={t.id} className="transition-colors hover:bg-muted/40">
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(t.date)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/drive/trips/${t.id}/edit`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {label}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{t.purpose ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                      {formatKm(t.distanceMeters)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Date
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Platform
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Description
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.earnings.map((e) => {
                const label = platformLabel(e.platform) ?? e.platform;
                return (
                  <tr key={e.id} className="transition-colors hover:bg-muted/40">
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(e.date)}</td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/drive/earnings/${e.id}/edit`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {e.description}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-500">
                      {formatCents(e.amountCents, e.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
