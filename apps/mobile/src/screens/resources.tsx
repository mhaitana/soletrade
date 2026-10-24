import { useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { CollectionPage } from "@soletrade/contracts";
import {
  Action,
  Choice,
  Copy,
  Empty,
  ErrorNotice,
  Field,
  Group,
  Loading,
  NavRow,
  Row,
  Screen,
  StatusPill,
  Toggle,
  formatMoney,
  human,
} from "@/components/ui";
import { authenticatedFetch } from "@/lib/api";
import { canWrite, catalog } from "@/lib/catalog";
import {
  detailHref,
  editHref,
  type Entity,
  listHref,
  useResource,
  useWorkspacePath,
} from "@/lib/resources";
import { token, useSession } from "@/lib/session";
import { nativeOperation } from "@/offline/store";
import { ReceiptReview } from "@/components/receipt-review";
import { ReferenceField } from "./editor";
import { periodDates, periodOptions } from "@/lib/periods";
import { spacing, useTheme } from "@/theme";

export function entityTitle(entity: Entity) {
  return String(
    entity.number ??
      entity.name ??
      entity.fullName ??
      entity.description ??
      entity.title ??
      entity.label ??
      entity.fileName ??
      entity.email ??
      entity.action ??
      entity.type ??
      "Record",
  );
}
export function entitySubtitle(entity: Entity) {
  return [
    entity.body,
    entity.sublabel,
    entity.customerName,
    entity.role,
    entity.actorFullName ?? entity.actorEmail,
    entity.company,
    entity.category ? human(String(entity.category)) : null,
    entity.date
      ? new Date(String(entity.date)).toLocaleDateString("en-AU")
      : entity.createdAt
        ? new Date(String(entity.createdAt)).toLocaleString("en-AU")
        : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function statusVariant(status?: string): "success" | "warning" | "danger" | "accent" | "neutral" {
  if (!status) return "neutral";
  const s = status.toLowerCase();
  if (s === "paid" || s === "accepted" || s === "synced" || s === "active") return "success";
  if (s === "overdue" || s === "declined" || s === "void" || s === "rejected" || s === "blocked") return "danger";
  if (s === "sent" || s === "viewed") return "accent";
  if (s === "pending" || s === "due soon") return "warning";
  return "neutral";
}
export function ResourceListScreen() {
  const { resource: encoded, status: initialStatus } = useLocalSearchParams<{
    resource: string;
    status?: string;
  }>();
  const resource = decodeURIComponent(encoded);
  const spec = catalog[resource];
  const theme = useTheme();
  const { bootstrap, request } = useSession();
  const base = useWorkspacePath(resource);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState(initialStatus ?? "");
  const [cursor, setCursor] = useState("");
  const [rows, setRows] = useState<Entity[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [asOf, setAsOf] = useState(() => new Date());
  const [filters, setFilters] = useState<Record<string, string>>({
    period: "all",
    type: "",
    category: "",
    platform: "",
    customerId: "",
    vehicleId: "",
    dateFrom: "",
    dateTo: "",
    unreadOnly: "",
  });
  const changeFilter = (key: string, value: string) => {
    setFilters((previous) => ({ ...previous, [key]: value }));
    if (key === "period") setAsOf(new Date());
    setCursor("");
  };
  const dated = [
    "invoices",
    "quotes",
    "books/transactions",
    "drive/earnings",
    "drive/trips",
    "drive/expenses",
  ].includes(resource);
  const query = new URLSearchParams();
  if (search) query.set("search", search);
  if (filter) query.set("status", filter);
  if (cursor) query.set("cursor", cursor);
  for (const [key, value] of Object.entries(filters))
    if (value && key !== "period" && !key.startsWith("date")) query.set(key, value);
  if (dated) {
    for (const [key, value] of Object.entries(
      periodDates(
        filters.period,
        Number(bootstrap?.activeWorkspace?.settings.fyStartMonth ?? 7),
        asOf,
      ),
    ))
      if (value) query.set(key, value);
    for (const key of ["dateFrom", "dateTo"])
      if (/^\d{4}-\d{2}-\d{2}$/.test(filters[key]))
        query.set(key, `${filters[key]}T${key === "dateFrom" ? "00:00:00.000" : "23:59:59.999"}Z`);
  }
  const path = base ? `${base}?${query}` : null;
  const state = useResource<CollectionPage<Entity>>(path);
  const reload = () => {
    const nextAsOf = new Date();
    const nextQuery = new URLSearchParams(query);
    nextQuery.delete("cursor");
    if (dated)
      for (const [key, value] of Object.entries(
        periodDates(
          filters.period,
          Number(bootstrap?.activeWorkspace?.settings.fyStartMonth ?? 7),
          nextAsOf,
        ),
      ))
        if (value && !/^\d{4}-\d{2}-\d{2}$/.test(filters[key])) nextQuery.set(key, value);
    const nextPath = base ? `${base}?${nextQuery}` : null;
    if (nextPath !== path) {
      setCursor("");
      setAsOf(nextAsOf);
    } else void state.refresh();
  };
  // Append the completed page while retaining previous pages during the next request.
  useEffect(() => {
    if (state.data)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Accumulate completed pagination responses.
      setRows((previous) =>
        cursor
          ? [
              ...previous,
              ...state
                .data!.items.map((item) => ({ ...item, id: String(item.id ?? item.userId) }))
                .filter((item) => !previous.some((old) => old.id === item.id)),
            ]
          : state.data!.items.map((item) => ({ ...item, id: String(item.id ?? item.userId) })),
      );
  }, [state.data, cursor]);
  if (state.denied)
    return (
      <Screen>
        <ErrorNotice message={state.error ?? "This resource is no longer available."} />
      </Screen>
    );
  if (!spec)
    return (
      <Screen>
        <ErrorNotice message="This list could not be found." />
      </Screen>
    );
  if (spec.module && !bootstrap?.activeWorkspace?.modules.includes(spec.module))
    return (
      <Screen>
        <Empty
          title={`${spec.title} is not enabled`}
          detail="An owner can change the workspace subscription."
          action={{ title: "View subscription", onPress: () => router.push("/feature/store") }}
        />
      </Screen>
    );
  if (spec.singleton) return <SingletonScreen resource={resource} />;
  const create = () =>
    router.push((resource === "files" ? "/upload" : editHref(resource)) as never);
  const header = (
    <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
      <Copy variant="title">{spec.title}</Copy>
      <Field
        label={`Search ${spec.title.toLowerCase()}`}
        value={search}
        onChangeText={(value) => {
          setSearch(value);
          setCursor("");
        }}
        autoCapitalize="none"
      />
      {spec.statuses && (
        <Choice
          label="Status"
          value={filter}
          options={[
            { label: "All statuses", value: "" },
            ...spec.statuses.map((value) => ({ label: human(value), value })),
          ]}
          onChange={(value) => {
            setFilter(value);
            setCursor("");
          }}
        />
      )}
      {(dated || resource === "notifications") && (
        <Toggle label="Show filters" value={showFilters} onChange={setShowFilters} />
      )}
      {showFilters && (
        <Group title="Filters">
          {dated && (
            <>
              <Choice
                label="Period"
                value={filters.period}
                options={periodOptions}
                onChange={(value) => changeFilter("period", value)}
              />
              <Field
                label="From date"
                placeholder="YYYY-MM-DD"
                value={filters.dateFrom}
                onChangeText={(value) => changeFilter("dateFrom", value)}
              />
              <Field
                label="To date"
                placeholder="YYYY-MM-DD"
                value={filters.dateTo}
                onChangeText={(value) => changeFilter("dateTo", value)}
              />
            </>
          )}
          {["invoices", "quotes", "books/transactions"].includes(resource) && (
            <ReferenceField
              label="Customer"
              resource="customers"
              value={filters.customerId}
              onChange={(value) => changeFilter("customerId", value)}
            />
          )}
          {resource === "books/transactions" && (
            <>
              <Choice
                label="Transaction type"
                value={filters.type}
                options={[
                  { label: "All income and expenses", value: "" },
                  { label: "Income", value: "income" },
                  { label: "Expense", value: "expense" },
                ]}
                onChange={(value) => changeFilter("type", value)}
              />
              <Choice
                label="Category"
                value={filters.category}
                options={[
                  { label: "All categories", value: "" },
                  ...(
                    catalog[resource].fields?.find((field) => field.key === "category")?.options ??
                    []
                  ).map((value) => ({ label: human(value), value })),
                ]}
                onChange={(value) => changeFilter("category", value)}
              />
            </>
          )}
          {["drive/earnings", "drive/trips"].includes(resource) && (
            <Choice
              label="Platform"
              value={filters.platform}
              options={[
                { label: "All platforms", value: "" },
                ...(
                  catalog[resource].fields?.find((field) => field.key === "platform")?.options ?? []
                ).map((value) => ({ label: human(value), value })),
              ]}
              onChange={(value) => changeFilter("platform", value)}
            />
          )}
          {resource === "drive/expenses" && (
            <>
              <ReferenceField
                label="Vehicle"
                resource="drive/vehicles"
                value={filters.vehicleId}
                onChange={(value) => changeFilter("vehicleId", value)}
              />
              <Choice
                label="Expense type"
                value={filters.type}
                options={[
                  { label: "All expenses", value: "" },
                  ...(
                    catalog[resource].fields?.find((field) => field.key === "type")?.options ?? []
                  ).map((value) => ({ label: human(value), value })),
                ]}
                onChange={(value) => changeFilter("type", value)}
              />
            </>
          )}
          {resource === "notifications" && (
            <Toggle
              label="Unread only"
              value={filters.unreadOnly === "true"}
              onChange={(value) => changeFilter("unreadOnly", value ? "true" : "")}
            />
          )}
          <Action
            title="Clear filters"
            secondary
            onPress={() => {
              setFilters({
                period: "all",
                type: "",
                category: "",
                platform: "",
                customerId: "",
                vehicleId: "",
                dateFrom: "",
                dateTo: "",
                unreadOnly: "",
              });
              setFilter("");
              setSearch("");
              setCursor("");
            }}
          />
        </Group>
      )}
      {canWrite(bootstrap?.activeWorkspace?.capabilities ?? [], resource) &&
        resource !== "members" && <Action title={`New ${spec.singular}`} onPress={create} />}
      {resource === "members" && (
        <>
          <NavRow title="Invite a team member" href={editHref("invitations")} />
          <NavRow title="Pending invitations" href={listHref("invitations")} />
        </>
      )}
      {resource === "books/receipts" && (
        <Action title="Capture receipt" onPress={() => router.push("/feature/receipt")} />
      )}
      {state.loading && rows.length > 0 && <Loading />}
      {state.error && (
        <ErrorNotice
          message={`${state.cached ? "Showing saved data. " : ""}${state.error}`}
          retry={reload}
        />
      )}
    </View>
  );
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        padding: spacing.md,
        paddingBottom: spacing.xxl,
        maxWidth: 820,
        width: "100%",
        alignSelf: "center",
      }}
      data={rows}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      renderItem={({ item }) => {
        const hasStatus = Boolean(item.status);
        const pill = hasStatus ? (
          <StatusPill
            label={human(String(item.status))}
            variant={statusVariant(String(item.status))}
          />
        ) : undefined;
        return (
          <View>
            <Row
              title={entityTitle(item)}
              subtitle={entitySubtitle(item)}
              badge={pill}
              trailing={
                item.totalCents != null || item.amountCents != null
                  ? formatMoney(item.totalCents ?? item.amountCents, String(item.currency ?? "AUD"))
                  : "›"
              }
              onPress={
                ["activity", "audit", "invitations"].includes(resource)
                  ? undefined
                  : resource === "notifications"
                    ? () => {
                        void request(`${base}/${item.id}/read`, { method: "POST", body: {} })
                          .then(() => state.refresh())
                          .catch((error) => Alert.alert("Could not mark read", String(error)));
                      }
                    : () => router.push(detailHref(resource, item.id) as never)
              }
            />
          {["activity", "audit"].includes(resource) && <EventDetails entity={item} />}
          {resource === "invitations" && (
            <>
              <Action
                title="Resend invitation"
                secondary
                onPress={() => {
                  void request(`${base}/${item.id}/resend`, { method: "POST", body: {} })
                    .then(() => state.refresh())
                    .catch((error) => Alert.alert("Could not resend", String(error)));
                }}
              />
              <Action
                title="Revoke invitation"
                secondary
                onPress={() =>
                  Alert.alert("Revoke invitation?", "This invitation will stop working.", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Revoke",
                      style: "destructive",
                      onPress: () => {
                        void request(`${base}/${item.id}`, { method: "DELETE", body: {} })
                          .then(() => state.refresh())
                          .catch((error) => Alert.alert("Could not revoke", String(error)));
                      },
                    },
                  ])
                }
              />
            </>
          )}
        </View>
        );
      }}
      ListEmptyComponent={
        state.loading ? (
          <Loading />
        ) : state.error ? (
          <Empty title="Could not load records" detail="Try again when connected." />
        ) : (
          <Empty
            title={search || filter ? "No matching records" : `No ${spec.title.toLowerCase()} yet`}
            detail={
              search || filter
                ? "Try a different search or status."
                : `Your ${spec.title.toLowerCase()} will appear here.`
            }
            action={
              canWrite(bootstrap?.activeWorkspace?.capabilities ?? [], resource)
                ? { title: `New ${spec.singular}`, onPress: create }
                : undefined
            }
          />
        )
      }
      refreshControl={
        <RefreshControl refreshing={state.loading && !!state.data} onRefresh={reload} />
      }
      ListFooterComponent={
        state.data?.nextCursor ? (
          <Action
            title="Load more"
            secondary
            busy={state.loading}
            onPress={() => setCursor(state.data!.nextCursor!)}
          />
        ) : undefined
      }
    />
  );
}
const hidden = new Set([
  "id",
  "workspaceId",
  "customerId",
  "publicToken",
  "stripePaymentIntentId",
  "stripeChargeId",
  "lineItems",
  "sections",
  "paymentMethods",
  "metadata",
  "payload",
  "storagePath",
  "userId",
  "uploadedByUserId",
  "sourceInvoiceId",
  "sourceEarningId",
  "sourceExpenseId",
  "sourceTripId",
  "convertedInvoiceId",
  "vehicleId",
  "defaultVehicleId",
  "ownerId",
  "memberId",
  "actorUserId",
  "entityId",
  "targetId",
  "receiptFileId",
  "billingContractId",
]);
function EventDetails({ entity }: { entity: Entity }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Action
        title={open ? "Hide event details" : "View event details"}
        secondary
        onPress={() => setOpen((previous) => !previous)}
      />
      {open && (
        <Group>
          <RecordFields
            value={{
              ...entity,
              ...(entity.metadata && typeof entity.metadata === "object" ? entity.metadata : {}),
            }}
          />
        </Group>
      )}
    </>
  );
}
export function RecordFields({ value }: { value: Record<string, unknown> }) {
  return (
    <>
      {Object.entries(value)
        .filter(([key, item]) => !hidden.has(key) && item != null && typeof item !== "object")
        .map(([key, item]) => (
          <Row
            key={key}
            title={human(key.replace(/Cents$/, ""))}
            subtitle={
              key.endsWith("Cents")
                ? formatMoney(item, String(value.currency ?? "AUD"))
                : typeof item === "boolean"
                  ? item
                    ? "Yes"
                    : "No"
                  : String(item)
            }
          />
        ))}
    </>
  );
}
export async function shareBinary(path: string, name: string) {
  const response = await authenticatedFetch(path, await token());
  if (!response.ok) throw new Error(`Could not prepare file (${response.status}).`);
  const file = new File(Paths.cache, name);
  await file.write(new Uint8Array(await response.arrayBuffer()));
  if (await Sharing.isAvailableAsync())
    await Sharing.shareAsync(file.uri, {
      mimeType: name.endsWith(".pdf") ? "application/pdf" : "text/csv",
    });
  else throw new Error("Sharing is unavailable on this device.");
}
export function ResourceDetailScreen() {
  const { resource: encoded, id } = useLocalSearchParams<{ resource: string; id: string }>();
  const resource = decodeURIComponent(encoded);
  const spec = catalog[resource];
  const { request, bootstrap, userId } = useSession();
  const base = useWorkspacePath(resource);
  const path = base ? `${base}/${id}` : null;
  const state = useResource<Entity>(path);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const acceptance = useResource<Entity>(
    resource === "quotes" && path ? `${path}/acceptance` : null,
  );
  const timeline = useResource<CollectionPage<Entity>>(
    resource === "customers" && path ? `${path}/timeline` : null,
  );
  const perform = async (action: string, body: unknown = {}) => {
    if (!path || busy) return;
    setBusy(true);
    setError("");
    try {
      await request(`${path}/${action}`, {
        method: "POST",
        body,
        version: state.data?.updatedAt,
        idempotencyKey: await nativeOperation(
          userId,
          `lifecycle:${path}:${action}:${state.data?.updatedAt ?? "initial"}`,
        ),
      });
      await state.refresh();
      await bootstrapRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete action.");
    } finally {
      setBusy(false);
    }
  };
  const { refreshBootstrap: bootstrapRefresh } = useSession();
  const confirm = (action: string, label: string) =>
    Alert.alert(`${label}?`, "This updates the shared business record.", [
      { text: "Cancel", style: "cancel" },
      { text: label, onPress: () => void perform(action) },
    ]);
  const remove = () =>
    Alert.alert(
      `Delete ${spec?.singular}?`,
      "This changes the shared business record and cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setBusy(true);
            void request(path!, { method: "DELETE", version: state.data?.updatedAt })
              .then(() => router.back())
              .catch((cause) => setError(String(cause)))
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  if (!state.data)
    return (
      <Screen>
        {state.error ? (
          <ErrorNotice message={state.error} retry={() => void state.refresh()} />
        ) : (
          <Loading />
        )}
      </Screen>
    );
  const entity = state.data;
  const status = String(entity.status ?? "");
  const caps = bootstrap?.activeWorkspace?.capabilities ?? [];
  const editable =
    resource !== "files" &&
    canWrite(caps, resource, "update") &&
    (!["invoices", "quotes"].includes(resource) || status === "draft") &&
    !entity.sourceInvoiceId &&
    !entity.sourceEarningId &&
    !entity.sourceExpenseId &&
    !entity.sourceTripId;
  return (
    <Screen>
      <Copy variant="title">{entityTitle(entity)}</Copy>
      {state.cached && <Copy muted>Saved copy. Connect to make changes.</Copy>}
      {(error || state.error) && <ErrorNotice message={error || state.error!} />}
      <Group>
        <RecordFields value={entity} />
      </Group>
      {resource === "books/receipts" && (
        <>
          <Action
            title="View original receipt"
            secondary
            onPress={() => {
              void request<{ url: string }>(
                `/workspaces/${bootstrap?.activeWorkspace?.id}/files/${entity.fileId}/read-url`,
              )
                .then((result) =>
                  import("expo-linking").then((linking) => linking.openURL(result.url)),
                )
                .catch((cause) => setError(String(cause)));
            }}
          />
          {caps.includes("manage:books") && (
            <ReceiptReview receipt={entity} onSaved={state.refresh} />
          )}
        </>
      )}

      {Array.isArray(entity.lineItems) && (
        <Group title="Line items">
          {entity.lineItems.map((line, index) => (
            <Row
              key={index}
              title={String(line.description)}
              subtitle={`${line.quantity} × ${formatMoney(line.unitPriceCents, String(entity.currency ?? "AUD"))}`}
              trailing={formatMoney(line.amountCents, String(entity.currency ?? "AUD"))}
            />
          ))}
        </Group>
      )}
      {Array.isArray(entity.sections) && entity.sections.length > 0 && (
        <Group title="Proposal sections">
          {entity.sections.map((section, index) => (
            <Group key={index} title={String(section.title)}>
              <Copy>{String(section.body)}</Copy>
              {section.optional && <Copy muted>Optional section</Copy>}
            </Group>
          ))}
        </Group>
      )}
      {Array.isArray(entity.paymentMethods) && entity.paymentMethods.length > 0 && (
        <Group title="Payment instructions">
          {entity.paymentMethods.map((payment, index) => (
            <RecordFields key={index} value={payment} />
          ))}
        </Group>
      )}
      {resource === "quotes" && acceptance.data && (
        <Group title="Customer acceptance">
          <RecordFields value={acceptance.data} />
        </Group>
      )}
      {resource === "customers" && (
        <Group title="Timeline">
          {timeline.loading && !timeline.data ? (
            <Loading />
          ) : timeline.error ? (
            <ErrorNotice message={timeline.error} retry={() => void timeline.refresh()} />
          ) : timeline.data?.items.length ? (
            timeline.data.items.map((item) => (
              <Row key={item.id} title={entityTitle(item)} subtitle={entitySubtitle(item)} />
            ))
          ) : (
            <Copy muted>No customer activity yet.</Copy>
          )}
          <Action
            title="Create invoice for customer"
            secondary
            onPress={() =>
              router.push({
                pathname: "/edit/[resource]/[id]",
                params: {
                  resource: "invoices",
                  id: "new",
                  prefill: JSON.stringify({ customerId: id }),
                },
              } as never)
            }
          />
        </Group>
      )}
      {resource === "books/transactions" &&
        ["sourceInvoiceId", "sourceEarningId", "sourceExpenseId", "sourceTripId"]
          .filter((key) => entity[key])
          .map((key) => (
            <Action
              key={key}
              title="Open source record"
              secondary
              onPress={() =>
                router.push(
                  detailHref(
                    (
                      {
                        sourceInvoiceId: "invoices",
                        sourceEarningId: "drive/earnings",
                        sourceExpenseId: "drive/expenses",
                        sourceTripId: "drive/trips",
                      } as Record<string, string>
                    )[key],
                    String(entity[key]),
                  ) as never,
                )
              }
            />
          ))}
      {editable && (
        <Action
          title={`Edit ${spec?.singular ?? "record"}`}
          onPress={() => router.push(editHref(resource, id) as never)}
        />
      )}
      {["invoices", "quotes"].includes(resource) && (
        <>
          <Action
            title="Share PDF"
            secondary
            busy={busy}
            onPress={() => {
              setBusy(true);
              void shareBinary(`${path}/pdf`, `${String(entity.number)}.pdf`)
                .catch((cause) => setError(String(cause)))
                .finally(() => setBusy(false));
            }}
          />
          {canWrite(caps, resource, "update") && (
            <>
              {["draft", "sent", "viewed", "overdue"].includes(status) && (
                <Action
                  title={entity.sentAt ? "Resend to customer" : "Send to customer"}
                  busy={busy}
                  onPress={() => confirm("send", "Send to customer")}
                />
              )}
              {resource === "invoices" && ["sent", "viewed", "overdue"].includes(status) && (
                <>
                  <Action
                    title="Mark paid"
                    busy={busy}
                    onPress={() => confirm("paid", "Mark paid")}
                  />
                  <Action
                    title="Void invoice"
                    secondary
                    busy={busy}
                    onPress={() => confirm("void", "Void invoice")}
                  />
                </>
              )}
              {resource === "quotes" && status === "accepted" && (
                <Action
                  title="Convert to invoice"
                  busy={busy}
                  onPress={() => confirm("convert", "Convert to invoice")}
                />
              )}
            </>
          )}
        </>
      )}
      {resource === "notifications" && !entity.readAt && (
        <Action title="Mark as read" onPress={() => void perform("read")} />
      )}
      {resource === "files" && (
        <Action
          title="Open file"
          secondary
          onPress={() => {
            void request<{ url: string }>(`${path}/read-url`)
              .then(({ url }) => import("expo-linking").then((linking) => linking.openURL(url)))
              .catch((cause) => setError(String(cause)));
          }}
        />
      )}
      {resource === "invitations" && (
        <Action
          title="Revoke invitation"
          secondary
          busy={busy}
          onPress={() => confirm("revoke", "Revoke invitation")}
        />
      )}
      {canWrite(caps, resource, "delete") && (
        <Action
          title={`Delete ${spec?.singular ?? "record"}`}
          secondary
          busy={busy}
          onPress={remove}
        />
      )}
    </Screen>
  );
}
export function SingletonScreen({ resource }: { resource: string }) {
  const path = useWorkspacePath(resource);
  const state = useResource<Entity>(path);
  const { bootstrap } = useSession();
  return (
    <Screen>
      <Copy variant="title">{catalog[resource]?.title}</Copy>
      {state.data ? (
        <Group>
          <RecordFields value={state.data} />
        </Group>
      ) : state.loading ? (
        <Loading />
      ) : null}
      {state.error && <ErrorNotice message={state.error} retry={() => void state.refresh()} />}
      {canWrite(bootstrap?.activeWorkspace?.capabilities ?? [], resource, "update") && (
        <Action
          title="Edit settings"
          onPress={() => router.push(editHref(resource, "settings") as never)}
        />
      )}
    </Screen>
  );
}
