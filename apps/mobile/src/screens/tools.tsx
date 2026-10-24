import { useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import * as Crypto from "expo-crypto";
import {
  Action,
  Choice,
  Copy,
  Empty,
  ErrorNotice,
  Field,
  Group,
  Loading,
  Row,
  Screen,
  Toggle,
  human,
} from "@/components/ui";
import { type Entity, detailHref, listHref, useResource, useWorkspacePath } from "@/lib/resources";
import { useSession } from "@/lib/session";
import { RecordFields, shareBinary } from "./resources";
import { periodDates } from "@/lib/periods";
import { TrendChart } from "@/components/trends";
import { ReferenceField } from "./editor";

export function navigateBusiness(href: string) {
  const path = href.split("?")[0];
  const params = new URLSearchParams(href.split("?")[1] ?? "");
  const match = path.match(/^\/(customers|invoices|quotes)\/([0-9a-fA-F-]{36})$/);
  if (match) {
    router.push(detailHref(match[1], match[2]) as never);
    return;
  }
  const books = path.match(/^\/books\/([0-9a-fA-F-]{36})$/);
  if (books) {
    router.push(detailHref("books/transactions", books[1]) as never);
    return;
  }
  const mapped: Record<string, string> = {
    "/drive": "/(tabs)/drive",
    "/books": "/(tabs)/money",
    "/files": listHref("files"),
    "/customers": listHref("customers"),
    "/invoices": listHref("invoices"),
    "/quotes": listHref("quotes"),
    "/": "/(tabs)",
    "/dashboard": "/(tabs)",
    "/books/receipts": listHref("books/receipts"),
    "/books/tax": "/tax",
    "/drive/vehicles": listHref("drive/vehicles"),
    "/drive/expenses": listHref("drive/expenses"),
    "/drive/settings": listHref("drive/settings"),
    "/activity": listHref("activity"),
    "/audit": listHref("audit"),
    "/billing": "/billing",
    "/settings": listHref("settings"),
    "/settings/modules": "/feature/store",
    "/settings/members": listHref("members"),
    "/settings/account": "/profile",
    "/assistant": "/assistant",
  };
  if (path === "/drive" && params.get("view") === "trips") {
    router.push(listHref("drive/trips") as never);
    return;
  }
  if (mapped[path])
    router.push(
      `${mapped[path]}${params.get("status") ? `?status=${encodeURIComponent(params.get("status")!)}` : ""}` as never,
    );
}
export function SearchScreen() {
  const [query, setQuery] = useState("");
  const base = useWorkspacePath("search");
  const state = useResource<{
    groups: { module: string; results: { id: string; label: string; href: string }[] }[];
  }>(query.trim().length >= 2 && base ? `${base}?q=${encodeURIComponent(query.trim())}` : null);
  return (
    <Screen>
      <Field
        label="Search customers, invoices, quotes and more"
        value={query}
        onChangeText={setQuery}
        autoFocus
        autoCapitalize="none"
        returnKeyType="search"
      />
      {query.trim().length < 2 ? (
        <Copy muted>Enter at least two characters.</Copy>
      ) : state.loading && !state.data ? (
        <Loading />
      ) : state.data?.groups.length ? (
        state.data.groups.map((group) => (
          <Group key={group.module} title={human(group.module)}>
            {group.results.map((result) => (
              <Row
                key={result.id}
                title={result.label}
                trailing="›"
                onPress={() => navigateBusiness(result.href)}
              />
            ))}
          </Group>
        ))
      ) : !state.error ? (
        <Empty title="No results" detail="Try a customer name, document number or description." />
      ) : null}
      {state.error && <ErrorNotice message={state.error} retry={() => void state.refresh()} />}
    </Screen>
  );
}
export function ReportsScreen() {
  const { bootstrap } = useSession();
  const base = useWorkspacePath("books");
  const [from, setFrom] = useState(
    periodDates(
      "year",
      Number(bootstrap?.activeWorkspace?.settings.fyStartMonth ?? 7),
    ).dateFrom!.slice(0, 10),
  );
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const download = async (type: "report" | "export") => {
    if (!base) return;
    setBusy(true);
    setError("");
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)
        throw new Error("Choose a valid date range.");
      await shareBinary(
        `${base}/${type}?dateFrom=${from}T00:00:00.000Z&dateTo=${to}T23:59:59.999Z`,
        type === "report" ? "books-report.pdf" : "books-transactions.csv",
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <Copy variant="title">Books reports</Copy>
      <Group>
        <Field label="From date" value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" />
        <Field label="To date" value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" />
      </Group>
      {error && <ErrorNotice message={error} />}
      <Action title="Share PDF report" busy={busy} onPress={() => void download("report")} />
      <Action
        title="Export transactions CSV"
        secondary
        busy={busy}
        onPress={() => void download("export")}
      />
    </Screen>
  );
}
export function TaxScreen() {
  const { request, bootstrap } = useSession();
  const base = useWorkspacePath("books/tax");
  const state = useResource<{
    gstSummary: Record<string, unknown>;
    lodgedPeriods: Entity[];
    currentQuarter: { fiscalYear: number; quarter: number };
    currency: string;
  }>(base);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lodge = () =>
    Alert.alert(
      "Mark this BAS period lodged?",
      "Confirm only after you have lodged this period with the ATO. This records the lodgement in your books.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mark lodged",
          onPress: () => {
            setBusy(true);
            void request(`${base}/lodge`, {
              method: "POST",
              body: { fiscalYear: Number(year), quarter: Number(quarter) },
              idempotencyKey: Crypto.randomUUID(),
            })
              .then(() => state.refresh())
              .catch((cause) => setError(String(cause)))
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  return (
    <Screen>
      <Copy variant="title">GST and BAS</Copy>
      {state.loading && !state.data ? (
        <Loading />
      ) : (
        state.data && (
          <>
            <Group title="GST overview">
              <RecordFields value={{ ...state.data.gstSummary, currency: state.data.currency }} />
            </Group>
            {Array.isArray(state.data.gstSummary.byQuarter) && (
              <TrendChart
                title="Quarterly net GST"
                points={state.data.gstSummary.byQuarter}
                valueKey="netGstCents"
                currency={state.data.currency}
              />
            )}
            <Group title="Lodged periods">
              {state.data.lodgedPeriods.length ? (
                state.data.lodgedPeriods.map((period) => (
                  <RecordFields key={period.id} value={period} />
                ))
              ) : (
                <Copy muted>No periods marked lodged.</Copy>
              )}
            </Group>
            {bootstrap?.activeWorkspace?.capabilities.includes("manage:books") && (
              <Group title="Record a lodgement">
                <Field
                  label="Financial year"
                  value={year}
                  onChangeText={setYear}
                  keyboardType="number-pad"
                />
                <Choice
                  label="Quarter"
                  value={quarter}
                  options={["1", "2", "3", "4"].map((value) => ({ label: `Q${value}`, value }))}
                  onChange={setQuarter}
                />
                <Action title="Mark BAS period lodged" busy={busy} onPress={lodge} />
              </Group>
            )}
          </>
        )
      )}
      {(error || state.error) && (
        <ErrorNotice message={error || state.error!} retry={() => void state.refresh()} />
      )}
    </Screen>
  );
}
export function LegalScreen() {
  const { bootstrap, request, closeAccount, userId } = useSession();
  const [confirmation, setConfirmation] = useState("");
  const [closeIds, setCloseIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const active = bootstrap?.activeWorkspace;
  const deleteAccount = () =>
    Alert.alert(
      "Permanently delete your account?",
      "Access is revoked immediately. Owned workspaces selected below will close. Personal and closed-workspace content is purged within 30 days.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: () => {
            setBusy(true);
            void request("/me/deletion", {
              method: "POST",
              body: { confirmation, closeWorkspaceIds: closeIds },
              idempotencyKey: Crypto.randomUUID(),
            })
              .then(closeAccount)
              .then(() => router.replace("/sign-in"))
              .catch((cause) => setError(String(cause)))
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  return (
    <Screen>
      <Copy variant="title">Privacy and your account</Copy>
      <Group title="Your information">
        <Copy>
          Precise routes are private to the recorder. Only reviewed mileage summaries are shared
          with the workspace. Route syncing starts off. Manage route history and device permissions
          in Device and privacy.
        </Copy>
        <Action
          title="Read privacy policy"
          secondary
          onPress={() => void Linking.openURL(`${process.env.EXPO_PUBLIC_API_URL}/privacy`)}
        />
        <Action
          title="Read terms"
          secondary
          onPress={() => void Linking.openURL(`${process.env.EXPO_PUBLIC_API_URL}/terms`)}
        />
      </Group>
      {active?.role === "owner" && (
        <Group title="Transfer workspace ownership">
          <Copy>
            Choose an existing member. They must accept the transfer before you can leave ownership
            behind.
          </Copy>
          <ReferenceField
            label="Accepting team member"
            resource="members"
            excludeIds={[userId]}
            value={recipient}
            onChange={setRecipient}
          />
          <Action
            title="Request ownership transfer"
            disabled={!recipient || busy}
            onPress={() => {
              setBusy(true);
              void request("/me/ownership-transfers", {
                method: "POST",
                body: { workspaceId: active.id, toUserId: recipient },
                idempotencyKey: Crypto.randomUUID(),
              })
                .then(() => setMessage("Transfer requested. The recipient must accept it."))
                .catch((cause) => setError(String(cause)))
                .finally(() => setBusy(false));
            }}
          />
        </Group>
      )}
      <OwnershipTransfers />
      <Group title="Delete account">
        <Copy>
          Export business records first. Transfer each workspace you own to an accepting member or
          select it for closure. Shared business records remain with anonymised attribution. Cancel
          store subscriptions in Apple or Google subscription settings; deleting the account does
          not stop a store renewal. Backup copies expire under the privacy policy.
        </Copy>
        {bootstrap?.workspaces
          .filter((workspace) => workspace.role === "owner")
          .map((workspace) => (
            <Toggle
              key={workspace.workspaceId}
              label={`Close ${workspace.name}`}
              value={closeIds.includes(workspace.workspaceId)}
              onChange={(checked) =>
                setCloseIds((previous) =>
                  checked
                    ? [...previous, workspace.workspaceId]
                    : previous.filter((id) => id !== workspace.workspaceId),
                )
              }
            />
          ))}
        <Copy muted>
          Reauthenticate using your password or email link, then submit within 10 minutes.
        </Copy>
        <Action
          title="Reauthenticate"
          secondary
          onPress={() => router.push({ pathname: "/sign-in", params: { returnTo: "back" } })}
        />
        <Field
          label="Type DELETE to confirm"
          value={confirmation}
          autoCapitalize="characters"
          onChangeText={setConfirmation}
        />
        <Action
          title="Delete my account"
          disabled={confirmation !== "DELETE"}
          busy={busy}
          onPress={deleteAccount}
        />
      </Group>
      {message && <Copy>{message}</Copy>}
      {error && <ErrorNotice message={error} />}
    </Screen>
  );
}
function OwnershipTransfers() {
  const { request, refreshBootstrap } = useSession();
  const state = useResource<{ items: Entity[] }>("/me/ownership-transfers");
  const [error, setError] = useState("");
  return state.data?.items.length ? (
    <Group title="Ownership requests">
      {state.data.items.map((item) => (
        <Action
          key={item.id}
          title="Accept workspace ownership"
          onPress={() => {
            void request(`/me/ownership-transfers/${item.id}/accept`, {
              method: "POST",
              body: {},
              idempotencyKey: Crypto.randomUUID(),
            })
              .then(() => refreshBootstrap())
              .then(() => state.refresh())
              .catch((cause) => setError(String(cause)));
          }}
        />
      ))}
      {error && <ErrorNotice message={error} />}
    </Group>
  ) : null;
}
