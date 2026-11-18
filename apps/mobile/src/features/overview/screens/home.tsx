import {
  Choice,
  Copy,
  ErrorNotice,
  Group,
  KpiTile,
  Loading,
  NavRow,
  Row,
  Screen,
  formatMoney,
  human,
} from "@/components/ui";
import { clearWidgets, updateOverviewWidget } from "@/lib/native/widgets";
import { type Entity, detailHref, listHref, useResource, useWorkspacePath } from "@/lib/resources";
import { useSession } from "@/lib/session";
import { spacing } from "@/theme/index";
import type { MobileHomeOverview } from "@soletrade/contracts";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

export function HomeScreen() {
  const { bootstrap, workspaceId, userId } = useSession();
  const [period, setPeriod] = useState("month");
  const base = useWorkspacePath("dashboard");
  const state = useResource<{ overview?: MobileHomeOverview; activity?: Entity[] }>(
    base ? `${base}?period=${period}` : null,
  );
  const active = bootstrap?.activeWorkspace;
  const overview =
    !state.denied &&
    state.data?.overview?.workspaceId === workspaceId &&
    state.data.overview.period === period
      ? state.data.overview
      : undefined;
  const attention =
    overview?.attention.filter((item) => {
      const module = item.resource.split("/")[0] as "invoices" | "quotes" | "books";
      const permission =
        item.resource === "books/receipts"
          ? "manage:books"
          : item.resource === "invoices"
            ? "view:invoice"
            : "view:quote";
      return active?.modules.includes(module) && active.capabilities.includes(permission);
    }) ?? [];
  const kpiTarget = (id: string) => {
    const has = (module: string, capability: string) =>
      !!active?.modules.includes(module as never) && !!active.capabilities.includes(capability);
    const books = has("books", "view:books"),
      invoices = has("invoices", "view:invoice"),
      drive = has("drive", "view:drive");
    if (id === "outstanding") return invoices ? "invoices" : undefined;
    if (id === "income")
      return books
        ? "books/transactions"
        : invoices
          ? "invoices"
          : drive
            ? "drive/earnings"
            : undefined;
    // Expenses and net income come from Books, or from Drive when the workspace has no Books.
    return books ? "books/transactions" : drive ? "drive/expenses" : undefined;
  };
  const activity =
    overview && active?.capabilities.includes("view:activity")
      ? (state.data?.activity ?? []).slice(0, 5)
      : [];
  useEffect(() => {
    if (state.denied) {
      void clearWidgets().catch(() => undefined);
      return;
    }
    if (!overview || !active || active.id !== workspaceId || !state.syncedAt) return;
    const income = overview.totalIncome.source
      ? `Income ${formatMoney(overview.totalIncome.currentCents, overview.currency)}`
      : "No income modules";
    const expenses = overview.kpis.find((item) => item.id === "expenses");
    void updateOverviewWidget(
      { userId, workspaceId },
      {
        workspaceName: active.name,
        summary: `${overview.periodLabel} · ${income}${expenses ? ` · Expenses ${formatMoney(expenses.cents, overview.currency)}` : ""}`,
        syncedAt: state.syncedAt,
      },
    ).catch(() => undefined);
  }, [overview, active, userId, workspaceId, state.syncedAt, state.denied]);
  return (
    <Screen onRefresh={() => state.refresh()}>
      <Copy variant="caption" muted>
        {new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}
      </Copy>
      <Copy variant="hero">Hello, {bootstrap?.user.fullName?.split(" ")[0] ?? "there"}.</Copy>
      <Row
        title={active?.name ?? "Your workspace"}
        subtitle="Switch workspace"
        trailing="›"
        onPress={() => router.push("/workspaces")}
      />
      <Choice
        label="Overview period"
        value={period}
        options={[
          { label: "This week", value: "week" },
          { label: "This month", value: "month" },
          { label: "This quarter", value: "quarter" },
          { label: "This financial year", value: "year" },
        ]}
        onChange={setPeriod}
      />
      {state.error && (
        <ErrorNotice
          message={`${state.cached ? "Showing your last saved overview. " : ""}${state.error}`}
          retry={() => void state.refresh()}
        />
      )}
      {state.loading && !state.data ? (
        <Loading />
      ) : (
        overview && (
          <>
            <Copy muted>
              {overview.periodLabel}
              {state.syncedAt ? ` · Last synced ${new Date(state.syncedAt).toLocaleString()}` : ""}
            </Copy>
            <Group title="At a glance">
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                {overview.kpis.slice(0, 4).map((item) => {
                  const target = kpiTarget(item.id);
                  return (
                    <View key={item.id} style={{ width: "48%", minWidth: 140, flexGrow: 1 }}>
                      <KpiTile
                        label={item.label}
                        value={formatMoney(item.cents, overview.currency)}
                        onPress={target ? () => router.push(listHref(target) as never) : undefined}
                      />
                    </View>
                  );
                })}
              </View>
              {!overview.kpis.length && (
                <Copy muted>No financial activity is available for your workspace role.</Copy>
              )}
            </Group>
            <Group title="Needs attention">
              {attention.length ? (
                attention.map((item) => (
                  <NavRow
                    key={item.id}
                    title={item.title}
                    subtitle={`${item.count} to review`}
                    href={`${listHref(item.resource)}?status=${encodeURIComponent(item.status)}`}
                  />
                ))
              ) : (
                <Copy muted>Nothing needs attention.</Copy>
              )}
            </Group>
            {active?.capabilities.includes("view:activity") && (
              <Group title="Recent activity">
                {activity.length ? (
                  activity.map((event) => (
                    <NavRow
                      key={event.id}
                      title={human(String(event.type ?? "Activity"))}
                      subtitle={`${event.actorFullName ?? "Your team"} · ${new Date(String(event.createdAt)).toLocaleString()}`}
                      href={detailHref("activity", event.id)}
                    />
                  ))
                ) : (
                  <Copy muted>No activity yet.</Copy>
                )}
                <NavRow title="View all activity" href={listHref("activity")} />
              </Group>
            )}
          </>
        )
      )}
      <Group title="Make a start">
        <NavRow
          title="Ask hAI"
          subtitle="Find records, draft work and get answers"
          href="/assistant"
        />
        <NavRow title="Search your business" href="/search" />
        {active?.modules.includes("books") && active.capabilities.includes("manage:books") && (
          <NavRow title="Capture a receipt" href="/feature/receipt" />
        )}
        {active?.modules.includes("drive") && active.capabilities.includes("create:drive") && (
          <NavRow title="Start or review a shift" href="/feature/shift" />
        )}
      </Group>
    </Screen>
  );
}
