import type { MobileHomeOverview } from "@soletrade/contracts";
import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import { Host, FieldGroup, ListItem, Text as NativeText, RNHostView } from "@expo/ui";
import { radius, spacing, typography, useTheme } from "@/theme";
import { SummaryView } from "@/components/trends";
import { periodDates, periodOptions } from "@/lib/periods";
import {
  Action,
  Choice,
  Copy,
  ErrorNotice,
  Group,
  KpiTile,
  Loading,
  NavRow,
  Row,
  Screen,
  human,
  formatMoney,
} from "@/components/ui";
import { type Entity, detailHref, listHref, useResource, useWorkspacePath } from "@/lib/resources";
import { useSession } from "@/lib/session";
import { SignOutButton } from "./auth";
import { RecordFields, shareBinary } from "./resources";
import { clearWidgets, updateOverviewWidget } from "@/native/widgets";

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
    <Screen>
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
                {overview.kpis.slice(0, 4).map((item) => (
                  <View key={item.id} style={{ width: "48%", minWidth: 140, flexGrow: 1 }}>
                    <KpiTile
                      label={item.label}
                      value={formatMoney(item.cents, overview.currency)}
                    />
                  </View>
                ))}
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
function ModuleSummary({ module }: { module: "books" | "drive" }) {
  const { bootstrap } = useSession();
  const [period, setPeriod] = useState("year");
  const [asOf, setAsOf] = useState(() => new Date());
  const base = useWorkspacePath(`${module}/summary`);
  const dates = periodDates(
    period,
    Number(bootstrap?.activeWorkspace?.settings.fyStartMonth ?? 7),
    asOf,
  );
  const query = new URLSearchParams(
    Object.entries(dates).filter(([, value]) => value !== undefined) as [string, string][],
  );
  const state = useResource<Record<string, unknown>>(base ? `${base}?${query}` : null);
  const reload = () => {
    const nextAsOf = new Date();
    if (period === "all" || nextAsOf.getTime() === asOf.getTime()) void state.refresh();
    else setAsOf(nextAsOf);
  };
  return (
    <>
      <Choice
        label="Summary period"
        value={period}
        options={periodOptions}
        onChange={(value) => {
          setAsOf(new Date());
          setPeriod(value);
        }}
      />
      {state.loading && !state.data ? (
        <Loading />
      ) : state.data ? (
        <SummaryView
          summary={state.data}
          currency={String(bootstrap?.activeWorkspace?.settings.defaultCurrency ?? "AUD")}
        />
      ) : null}
      {state.error && <ErrorNotice message={state.error} retry={reload} />}
    </>
  );
}
export function SalesScreen() {
  const { bootstrap } = useSession();
  const modules = bootstrap?.activeWorkspace?.modules ?? [];
  const caps = bootstrap?.activeWorkspace?.capabilities ?? [];
  return (
    <Screen>
      <Copy variant="title">Sales</Copy>
      <Copy muted>Good relationships. Clear proposals. Paid invoices.</Copy>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        {modules.includes("quotes") && caps.includes("manage:quote") && (
          <View style={{ flex: 1 }}>
            <Action title="Create quote" onPress={() => router.push("/edit/quotes/new")} />
          </View>
        )}
        {modules.includes("invoices") && caps.includes("manage:invoice") && (
          <View style={{ flex: 1 }}>
            <Action title="Create invoice" onPress={() => router.push("/edit/invoices/new")} />
          </View>
        )}
      </View>
      <Group>
        <NavRow
          title="Customers"
          subtitle="Contacts, history and notes"
          href={listHref("customers")}
        />
        {modules.includes("invoices") && (
          <NavRow
            title="Invoices"
            subtitle="Draft, send and track payments"
            href={listHref("invoices")}
          />
        )}
        {modules.includes("quotes") && (
          <NavRow
            title="Quotes"
            subtitle="Proposals through to accepted work"
            href={listHref("quotes")}
          />
        )}
      </Group>
    </Screen>
  );
}
export function MoneyScreen() {
  const { bootstrap } = useSession();
  if (
    bootstrap?.activeWorkspace?.modules.includes("books") &&
    !bootstrap.activeWorkspace.capabilities.includes("view:books")
  )
    return (
      <Screen>
        <Copy variant="title">Money</Copy>
        <Copy>Your workspace role does not include access to Books.</Copy>
      </Screen>
    );
  if (!bootstrap?.activeWorkspace?.modules.includes("books"))
    return (
      <Screen>
        <Copy variant="title">Money</Copy>
        <Copy>Enable Books to keep income, expenses and receipts together.</Copy>
        <NavRow title="Subscription" href="/feature/store" />
      </Screen>
    );
  return (
    <Screen>
      <Copy variant="title">Money</Copy>
      <Copy muted>A clear view of what comes in and goes out.</Copy>
      {bootstrap.activeWorkspace.capabilities.includes("manage:books") && (
        <Action title="Capture receipt" onPress={() => router.push("/feature/receipt")} />
      )}
      <ModuleSummary module="books" />
      <Group>
        <NavRow title="Transactions" href={listHref("books/transactions")} />
        <NavRow title="Receipts" href={listHref("books/receipts")} />
        {bootstrap.activeWorkspace.capabilities.includes("manage:books") && (
          <NavRow title="Capture receipt" href="/feature/receipt" />
        )}
        <NavRow title="GST and BAS" href="/tax" />
        <NavRow title="Reports and export" href="/reports" />
      </Group>
    </Screen>
  );
}
export function DriveScreen() {
  const { bootstrap } = useSession();
  if (
    bootstrap?.activeWorkspace?.modules.includes("drive") &&
    !bootstrap.activeWorkspace.capabilities.includes("view:drive")
  )
    return (
      <Screen>
        <Copy variant="title">Drive</Copy>
        <Copy>Your workspace role does not include access to Drive.</Copy>
      </Screen>
    );
  if (!bootstrap?.activeWorkspace?.modules.includes("drive"))
    return (
      <Screen>
        <Copy variant="title">Drive</Copy>
        <Copy>Enable Drive to record gig earnings, mileage and vehicle expenses.</Copy>
        <NavRow title="Subscription" href="/feature/store" />
      </Screen>
    );
  return (
    <Screen>
      <Copy variant="title">Drive</Copy>
      <Copy muted>Your working day, from the first kilometre.</Copy>
      {bootstrap.activeWorkspace.capabilities.includes("create:drive") && (
        <Action title="Start or review shift" onPress={() => router.push("/feature/shift")} />
      )}
      <ModuleSummary module="drive" />
      <Group>
        {[
          "drive/earnings",
          "drive/trips",
          "drive/vehicles",
          "drive/expenses",
          "drive/settings",
        ].map((resource) => (
          <NavRow
            key={resource}
            title={
              {
                "drive/earnings": "Earnings",
                "drive/trips": "Mileage",
                "drive/vehicles": "Vehicles",
                "drive/expenses": "Vehicle expenses",
                "drive/settings": "Drive settings",
              }[resource]!
            }
            href={listHref(resource)}
          />
        ))}
      </Group>
      <Action
        title="Export Drive records"
        secondary
        onPress={() => {
          void shareBinary(
            `/workspaces/${bootstrap.activeWorkspace!.id}/drive/export`,
            "drive.csv",
          ).catch((error) => alert(String(error)));
        }}
      />
    </Screen>
  );
}
export function MoreScreen() {
  const { bootstrap } = useSession();
  const theme = useTheme();
  const caps = bootstrap?.activeWorkspace?.capabilities ?? [];
  const work = [
    { label: "hAI assistant", href: "/assistant" },
    { label: "Search", href: "/search" },
    { label: "Files", href: listHref("files") },
    { label: "Activity", href: listHref("activity") },
    { label: "Notifications", href: listHref("notifications") },
    ...(caps.includes("view:audit") ? [{ label: "Audit trail", href: listHref("audit") }] : []),
    ...(caps.includes("view:member") || caps.includes("manage:member")
      ? [{ label: "Team", href: listHref("members") }]
      : []),
  ];
  const settings = [
    { label: "My account", href: "/profile" },
    { label: "Business settings", href: listHref("settings") },
    { label: "Workspaces", href: "/workspaces" },
    { label: "Subscription and billing", href: "/billing" },
    { label: "Device and privacy", href: "/feature/device" },
    { label: "Offline drafts", href: "/feature/drafts" },
    { label: "Privacy, terms and account deletion", href: "/legal" },
  ];
  return (
    <Host seedColor={theme.accent} style={{ flex: 1 }}>
      <View
        style={{
          margin: spacing.md,
          marginBottom: spacing.xs,
          padding: spacing.md,
          borderRadius: radius.md,
          borderCurve: "continuous",
          backgroundColor: theme.surface,
          borderColor: theme.line,
          borderWidth: 1,
          gap: spacing.xs,
        }}
      >
        <Text style={[typography.headline, { color: theme.text }]}>
          {bootstrap?.activeWorkspace?.name ?? "Workspace"}
        </Text>
        <Text style={[typography.caption, { color: theme.muted }]}>
          {bootstrap?.user.fullName ?? "User"} · Role: {bootstrap?.activeWorkspace?.role ?? "member"}
        </Text>
      </View>
      <FieldGroup>
        <FieldGroup.Section title="Your business">
          {work.map((item) => (
            <ListItem key={item.href} onPress={() => router.push(item.href as never)}>
              <NativeText>{item.label}</NativeText>
            </ListItem>
          ))}
        </FieldGroup.Section>
        <FieldGroup.Section title="Settings">
          {settings.map((item) => (
            <ListItem key={item.href} onPress={() => router.push(item.href as never)}>
              <NativeText>{item.label}</NativeText>
            </ListItem>
          ))}
        </FieldGroup.Section>
        <FieldGroup.Section>
          <RNHostView matchContents>
            <SignOutButton />
          </RNHostView>
        </FieldGroup.Section>
      </FieldGroup>
    </Host>
  );
}
export function BillingScreen() {
  const path = useWorkspacePath("billing");
  const state = useResource<Entity>(path);
  return (
    <Screen>
      <Copy variant="title">Subscription</Copy>
      {state.loading && !state.data ? (
        <Loading />
      ) : state.data ? (
        <Group>
          <RecordFields value={state.data} />
        </Group>
      ) : null}
      {state.error && <ErrorNotice message={state.error} retry={() => void state.refresh()} />}
      {state.data && (
        <>
          <Group title="Active modules">
            <Copy>
              {Array.isArray(state.data.modules)
                ? state.data.modules.map(String).map(human).join(", ")
                : "No active modules"}
            </Copy>
          </Group>
          {Array.isArray(state.data.recentLedger) && state.data.recentLedger.length > 0 && (
            <Group title="Recent web credit activity">
              {state.data.recentLedger.map((entry, index) => (
                <RecordFields key={index} value={entry} />
              ))}
            </Group>
          )}
          {typeof state.data.managementUrl === "string" && (
            <Action
              title="Manage provider subscription"
              secondary
              onPress={() => void Linking.openURL(String(state.data!.managementUrl))}
            />
          )}
        </>
      )}
      <NavRow title="Manage native subscription" href="/feature/store" />
      <Copy muted>
        Each workspace has one billing provider. Existing coverage must end before switching
        providers.
      </Copy>
    </Screen>
  );
}
