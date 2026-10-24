import { Action, NativePage, Note } from "@/components/native-ui";
import { Status, useOperation } from "@/components/operation";
import { ReceiptCaptureScreen } from "@/features/receipts/screens/capture";
import {
  discardDraft,
  explicitSave,
  listDrafts,
  recoverCapturedFiles,
  syncOutbox,
  type Draft,
} from "@/lib/offline/store";
import type { MobileFeatureProps } from "@soletrade/contracts";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

export function DraftsScreen(props: MobileFeatureProps) {
  return <Drafts key={`${props.userId}:${props.workspaceId}`} {...props} />;
}

export function Drafts(incoming: MobileFeatureProps) {
  const [props] = useState(incoming);
  const op = useOperation(),
    [rows, setRows] = useState<Draft[] | null>(null),
    [selected, setSelected] = useState<Draft | null>(null);
  const { run } = op;
  const refresh = async () => setRows(await listDrafts(props));
  useEffect(() => {
    let live = true;
    void recoverCapturedFiles(props)
      .then(() => listDrafts(props))
      .then((value) => {
        if (live) setRows(value);
      })
      .catch((e) => {
        if (live)
          void run(async () => {
            throw e;
          });
      });
    return () => {
      live = false;
    };
  }, [props, run]);
  if (selected)
    return (
      <>
        <Action
          title="Back to drafts"
          onPress={() => {
            setSelected(null);
            void refresh();
          }}
        />
        <ReceiptCaptureScreen
          {...props}
          initialDraft={selected}
          onSaved={() => {
            setSelected(null);
            void refresh();
            props.onSaved?.();
          }}
        />
      </>
    );
  return (
    <NativePage title="Drafts & uploads">
      <Note>
        Bound to this account and workspace. Save queues a new record. Existing records require an
        online edit. Blocked work stays here after access or module changes.
      </Note>
      <Status operation={op} />
      <Action
        title="Sync queued saves"
        disabled={op.busy}
        onPress={() =>
          void run(async () => {
            await recoverCapturedFiles(props);
            const result = await syncOutbox(props, props.request);
            await refresh();
            return `${result.sent} saved, ${result.failed} retained for retry.`;
          })
        }
      />
      {rows === null ? (
        <ActivityIndicator />
      ) : rows.length === 0 ? (
        <Note>No local drafts. Capture a receipt or create a new record to work offline.</Note>
      ) : (
        rows.map((row) => (
          <View
            key={row.id}
            style={{
              gap: 10,
              padding: 14,
              borderWidth: 1,
              borderColor: "#8495a4",
              borderRadius: 12,
            }}
          >
            <Note>
              {(
                {
                  "receipt-expense": "Captured expense",
                  "receipt-attachment": "Receipt attachment",
                  "receipt-recovered": "Recovered original",
                  customers: "Customer",
                  invoices: "Invoice draft",
                  quotes: "Quote draft",
                  "books/transactions": "Money record",
                  "drive/trips": "Mileage",
                  "drive/earnings": "Drive earnings",
                  "drive/expenses": "Vehicle expense",
                } as Record<string, string>
              )[row.kind] ?? "Draft"}
              {" · "}
              {(
                {
                  draft: "On this device",
                  queued: "Waiting to save",
                  sending: "Saving",
                  blocked: "Needs attention",
                  synced: "Saved to workspace",
                } as Record<string, string>
              )[row.status] ?? "Needs attention"}
            </Note>
            {(row.status === "draft" ||
              (row.status === "blocked" &&
                row.validationRejected === true &&
                row.uncertainOutcome === false)) &&
              row.kind.startsWith("receipt-") && (
                <Action
                  title={
                    row.status === "blocked"
                      ? "Correct captured expense"
                      : "Resume capture and review"
                  }
                  onPress={() => setSelected(row)}
                />
              )}
            {row.status === "blocked" &&
              row.validationRejected === true &&
              row.uncertainOutcome === false &&
              [
                "invoices",
                "quotes",
                "books/transactions",
                "drive/trips",
                "drive/earnings",
                "drive/expenses",
              ].includes(row.kind) &&
              row.path === `/workspaces/${props.workspaceId}/${row.kind}` && (
                <Action
                  title="Correct draft"
                  disabled={op.busy}
                  onPress={() =>
                    router.push(
                      `/edit/${encodeURIComponent(row.kind)}/new?draftId=${encodeURIComponent(row.id)}&userId=${encodeURIComponent(row.userId)}&workspaceId=${encodeURIComponent(row.workspaceId)}` as never,
                    )
                  }
                />
              )}
            {row.status === "blocked" && row.uncertainOutcome === true && (
              <Note>
                A previous attempt may have reached the server. Keep the original operation for
                retry or check its status before creating another record.
              </Note>
            )}
            {typeof (row.body.description ?? row.body.name) === "string" && (
              <Note>{String(row.body.description ?? row.body.name)}</Note>
            )}
            {Array.isArray(row.body.lineItems) && (
              <Note>
                {row.body.lineItems.length} line{" "}
                {row.body.lineItems.length === 1 ? "item" : "items"}.
              </Note>
            )}
            {typeof row.body.amountCents === "number" &&
              Number.isSafeInteger(row.body.amountCents) && (
                <Note>
                  {new Intl.NumberFormat("en-AU", {
                    style: "currency",
                    currency: typeof row.body.currency === "string" ? row.body.currency : "AUD",
                  }).format(row.body.amountCents / 100)}
                </Note>
              )}
            {row.files.length > 0 && (
              <Note>
                {row.files[0].name}
                {row.files.length > 1 ? ` and ${row.files.length - 1} more` : ""}
              </Note>
            )}
            {row.error && <Note error>{row.error}</Note>}
            <Note>
              Saved {new Date(row.updatedAt).toLocaleString()} · attempts {row.attempts}
            </Note>
            {row.status !== "synced" &&
              row.kind !== "receipt-attachment" &&
              (!row.kind.startsWith("receipt-") || row.status !== "draft") && (
                <Action
                  title={row.status === "draft" ? "Save this draft" : "Retry this save"}
                  disabled={op.busy || row.status === "sending"}
                  onPress={() =>
                    void run(async () => {
                      await explicitSave(props, row.id);
                      await syncOutbox(props, props.request);
                      await refresh();
                    })
                  }
                />
              )}
            <Action
              title={row.status === "synced" ? "Remove local copy" : "Discard local draft"}
              disabled={op.busy || row.status === "sending"}
              onPress={() =>
                void run(async () => {
                  await discardDraft(props, row.id);
                  await refresh();
                })
              }
            />
          </View>
        ))
      )}
    </NativePage>
  );
}
