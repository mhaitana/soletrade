import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { PERIODS, parsePeriod, type Period } from "@/shared/utils/periods";
import { MODULES, MODULE_KEYS } from "@/shared/constants/modules";
import { ActivityFeed } from "../activity/activity-feed";
import { loadDashboardPage } from "./actions";
import { KpiCard } from "./kpi-card";
import { ModuleSummaryCard } from "./module-summary-card";
import { AttentionList } from "./attention-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

const PERIOD_NOUN: Record<Exclude<Period, "all">, string> = {
  week: "last week",
  month: "last month",
  quarter: "last quarter",
  year: "last year",
  calendar: "last calendar year",
};

const CHECKLIST = [
  { label: "Create your workspace", complete: true },
  { label: "Enable your first module", complete: false },
  { label: "Add a customer", complete: false },
  { label: "Send your first invoice or quote", complete: false },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[] }>;
}) {
  const sp = await searchParams;
  const rawPeriod = typeof sp.period === "string" ? sp.period : undefined;
  // Dashboard default is "month" (parsePeriod's own default is "year") so the KPI deltas read
  // "vs last month". "all" is allowed - its KPIs just render no delta badge (no previous period).
  const period: Period = rawPeriod ? parsePeriod(rawPeriod) : "month";
  const data = await loadDashboardPage({ period });
  const periodNoun: string = period === "all" ? "" : PERIOD_NOUN[period];

  // --- Onboarding branch: zero modules installed → keep the starter checklist + enable cards.
  if (data.onboarding) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your workspace is ready. Enable your first module to start managing your business.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-primary" aria-hidden />
              Onboarding
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {CHECKLIST.map((step, i) => (
              <div key={step.label} className="flex items-center gap-3 text-sm">
                <span
                  className={`grid size-5 place-items-center rounded-full border text-xs ${
                    step.complete
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-border text-muted-foreground"
                  }`}
                  aria-hidden
                >
                  {step.complete ? <Check className="size-3" /> : i + 1}
                </span>
                <span className="text-foreground">{step.label}</span>
                <Badge variant={step.complete ? "success" : "outline"} className="ml-auto">
                  {step.complete ? "Done" : "Next"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <section>
          <h2 className="mb-1 text-sm font-medium text-muted-foreground">Build your workspace</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Start with the module you need today. Add more whenever your business grows.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {MODULE_KEYS.map((key) => {
              const m = MODULES[key];
              const Icon = m.icon;
              return (
                <Card key={key} className="transition-colors hover:border-primary/40">
                  <CardHeader>
                    <Icon className="size-5 text-primary" aria-hidden />
                    <CardTitle className="mt-3 text-sm">{m.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">{m.description}</p>
                    <Link
                      href="/settings/modules"
                      className="mt-4 block text-xs font-medium text-brand-blue"
                    >
                      Enable module →
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">Recent activity</h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/activity">View all</Link>
            </Button>
          </div>
          <ActivityFeed items={data.activity.items} />
        </section>
      </div>
    );
  }

  // --- Real dashboard: period selector + KPI row + per-module summary cards + activity.
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Business overview
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{data.workspaceName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Income, cash, work, and follow-ups - {period === "all" ? "all time" : `this ${period}`}.
          </p>
        </div>
        {/* Period selector - SegmentedControl; active period highlighted. */}
        <SegmentedControl
          label="Dashboard period"
          items={PERIODS.map((p) => ({
            key: p.key,
            label: p.label,
            href: `/dashboard?period=${p.key}`,
            active: p.key === period,
          }))}
        />
      </div>

      {/* KPI row */}
      <section aria-label="Key metrics">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {data.kpis.map((kpi) => (
            <KpiCard key={kpi.id} kpi={kpi} periodNoun={periodNoun} />
          ))}
        </div>
      </section>

      <section aria-labelledby="attention-heading">
        <div className="mb-3">
          <h2 id="attention-heading" className="text-base font-semibold">
            Needs attention
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The next actions most likely to keep cash and paperwork moving.
          </p>
        </div>
        <AttentionList items={data.attentionItems} />
      </section>

      {/* Per-module summary cards */}
      {data.moduleCards.length > 0 ? (
        <section aria-label="Module summaries">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Modules</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.moduleCards.map((card) => (
              <ModuleSummaryCard key={card.key} card={card} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Recent activity */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">Recent activity</h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/activity">View all</Link>
          </Button>
        </div>
        <ActivityFeed items={data.activity.items} />
      </section>
    </div>
  );
}
