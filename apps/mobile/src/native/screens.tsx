import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, View } from "react-native";
import { Host, Switch } from "@expo/ui";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import type {
  CollectionPage,
  MobileFeatureProps,
  MobilePreferences,
  MobileBootstrap,
} from "@soletrade/contracts";
import { DEFAULT_MOBILE_PREFERENCES } from "@soletrade/contracts";
import {
  createDraft,
  correctRejectedDraft,
  getDraft,
  discardDraft,
  durableFile,
  explicitSave,
  listDrafts,
  markDraftSynced,
  nativeOperation,
  readState,
  readReference,
  recoverCapturedFiles,
  syncOutbox,
  updateDraft,
  uploadDraftFiles,
  writeState,
  type Draft,
} from "../offline/store";
import {
  changeShift,
  currentShift,
  deletePrivateRoute,
  listPrivateRouteHistory,
  type PrivateRouteHistory,
  reconcileRouteDeletions,
  recoverShift,
  saveReviewedShift,
  startShift,
  syncPrivateRoute,
  continueManualShift,
  type ShiftSession,
} from "./shift";
import { summarizePoints } from "./gps-policy";
import {
  appLockEnabled,
  configureAppLock,
  registerPush,
  setDeviceNotificationPreferences,
  unregisterPush,
} from "./device";
import { clearWidgets, configureWidget } from "./widgets";
import { Action, Field, NativePage, Note } from "./ui";
import { PrivateRouteMap } from "./route-map";
import { gigAppLink, gigAppLabel } from "./gig-launch";
import { receiptCurrency, receiptReviewFields, RECEIPT_CURRENCIES } from "./receipt-policy";
export { StorePurchaseScreen } from "./store-purchase";
export type { MobileFeatureProps } from "@soletrade/contracts";

function useOperation() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const running = useRef(false);
  const run = useCallback(async (work: () => Promise<string | void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await work();
      if (result) setMessage(result);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, message, error, run };
}
function Status({ operation }: { operation: ReturnType<typeof useOperation> }) {
  return (
    <>
      {operation.busy && <ActivityIndicator accessibilityLabel="Working" />}
      {operation.error && <Note error>{operation.error}</Note>}
      {operation.message && <Note>{operation.message}</Note>}
    </>
  );
}
const expenseCategories = [
  "supplies",
  "travel",
  "vehicle_expense",
  "software_expense",
  "rent",
  "utilities",
  "wages",
  "other_expense",
];
export function ReceiptCaptureScreen(props: MobileFeatureProps & { initialDraft?: Draft }) {
  return (
    <ReceiptCapture
      key={`${props.userId}:${props.workspaceId}:${props.initialDraft?.id ?? "new"}`}
      {...props}
    />
  );
}
function ReceiptCapture(incoming: MobileFeatureProps & { initialDraft?: Draft }) {
  const [props] = useState(incoming);
  const { userId, workspaceId, request, onSaved } = props,
    op = useOperation();
  const { run } = op;
  const [mode, setMode] = useState<"expense" | "attachment">(
      props.initialDraft?.kind === "receipt-attachment" ? "attachment" : "expense",
    ),
    [draft, setDraft] = useState<Draft | null>(props.initialDraft ?? null),
    [target, setTarget] = useState(""),
    [description, setDescription] = useState(String(props.initialDraft?.body.description ?? "")),
    [amount, setAmount] = useState(
      props.initialDraft?.body.amountCents
        ? String(Number(props.initialDraft.body.amountCents) / 100)
        : "",
    ),
    [date, setDate] = useState(
      String(props.initialDraft?.body.date ?? new Date().toISOString().slice(0, 10)),
    ),
    [category, setCategory] = useState(String(props.initialDraft?.body.category ?? "supplies")),
    [currency, setCurrency] = useState(String(props.initialDraft?.body.currency ?? "AUD"));
  const currencyChosen = useRef(!!props.initialDraft?.body.currency);
  const [extraction, setExtraction] = useState<{
    id: string;
    extractedData: Record<string, unknown> | null;
    errorMessage?: string;
    processing?: boolean;
  } | null>(null);
  const [transactions, setTransactions] = useState<
      { id: string; description: string; amountCents: number; date: string; currency?: string }[]
    >([]),
    [transactionCursor, setTransactionCursor] = useState<string | null | undefined>(),
    [transactionError, setTransactionError] = useState(""),
    [transactionsLoading, setTransactionsLoading] = useState(false);
  const loadTransactions = useCallback(
    async (cursor?: string | null) => {
      setTransactionsLoading(true);
      setTransactionError("");
      try {
        const result = await request<
          CollectionPage<{
            id: string;
            description: string;
            amountCents: number;
            date: string;
            currency?: string;
          }>
        >(
          `/workspaces/${workspaceId}/books/transactions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        setTransactions((previous) => (cursor ? [...previous, ...result.items] : result.items));
        setTransactionCursor(result.nextCursor);
      } catch (cause) {
        setTransactionError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setTransactionsLoading(false);
      }
    },
    [request, workspaceId],
  );
  useEffect(() => {
    if (mode !== "attachment") return;
    let live = true;
    void request<
      CollectionPage<{
        id: string;
        description: string;
        amountCents: number;
        date: string;
        currency?: string;
      }>
    >(`/workspaces/${workspaceId}/books/transactions`)
      .then((result) => {
        if (live) {
          setTransactions(result.items);
          setTransactionCursor(result.nextCursor);
        }
      })
      .catch((cause) => {
        if (live) setTransactionError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      live = false;
    };
  }, [mode, request, workspaceId]);
  useEffect(() => {
    if (currencyChosen.current) return;
    let live = true;
    const applyDefault = (bootstrap: MobileBootstrap | null) => {
      if (
        !live ||
        currencyChosen.current ||
        bootstrap?.user.id !== userId ||
        bootstrap.activeWorkspace?.id !== workspaceId
      )
        return;
      try {
        setCurrency(receiptCurrency(bootstrap.activeWorkspace.settings.defaultCurrency ?? "AUD"));
      } catch {
        /* Keep the visible review value until a supported currency is chosen. */
      }
    };
    void (async () => {
      const cached = await readReference<MobileBootstrap>(props, "bootstrap").catch(() => null);
      applyDefault(cached?.data ?? null);
      try {
        applyDefault(
          await request<MobileBootstrap>(
            `/bootstrap?workspaceId=${encodeURIComponent(workspaceId)}`,
          ),
        );
      } catch {
        /* Offline captures keep their explicit visible currency. */
      }
    })();
    return () => {
      live = false;
    };
  }, [props, request, userId, workspaceId]);
  const body = useCallback(
    () => ({
      type: "expense",
      description,
      amountCents: Math.round(Number(amount) * 100),
      date,
      category,
      currency: currency.trim().toUpperCase(),
    }),
    [description, amount, date, category, currency],
  );
  useEffect(() => {
    const saved = props.initialDraft;
    if (saved) {
      void readState<typeof extraction>(`ocr:${saved.id}`).then(setExtraction);
      void readState<string>(`attachment-target:${saved.id}`).then((value) =>
        setTarget(value ?? ""),
      );
    }
  }, [props.initialDraft]);
  useEffect(() => {
    if (!draft || draft.status !== "draft") return;
    const timer = setTimeout(() => {
      void updateDraft(props, draft.id, body()).catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [body, draft, props]);
  const extractionId = extraction?.id,
    extractionProcessing = extraction?.processing;
  const [extractionError, setExtractionError] = useState("");
  useEffect(() => {
    if (!extractionId || !extractionProcessing) return;
    let live = true;
    const poll = async () => {
      try {
        const value = await request<NonNullable<typeof extraction>>(
          `/workspaces/${workspaceId}/books/receipts/${extractionId}`,
        );
        if (live) {
          setExtraction(value);
          setExtractionError("");
          if (draft) await writeState(`ocr:${draft.id}`, value);
        }
      } catch (cause) {
        if (live) setExtractionError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    const timer = setInterval(() => void poll(), 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [extractionId, extractionProcessing, request, workspaceId, draft]);
  const capture = async (source: "camera" | "library" | "document") => {
    let uri = "",
      name = "",
      mimeType = "";
    if (source === "document") {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["image/*", "application/pdf"],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      uri = file.uri;
      name = file.name;
      mimeType = file.mimeType ?? "application/octet-stream";
    } else {
      const permission =
        source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted)
        throw new Error(
          "Capture permission denied. Choose a document or enable access in device Settings.",
        );
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ quality: 0.9 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
      if (result.canceled) return;
      const file = result.assets[0];
      uri = file.uri;
      name = file.fileName ?? "receipt.jpg";
      mimeType = file.mimeType ?? "image/jpeg";
    }
    const file = await durableFile({ userId, workspaceId }, uri, name, mimeType);
    const next = await createDraft({
      ...props,
      kind: mode === "expense" ? "receipt-expense" : "receipt-attachment",
      path: `/workspaces/${workspaceId}/books/transactions`,
      body: body(),
      files: [file],
    });
    setDraft(next);
    setExtraction(null);
    return "Original saved on this device. Review before saving to your workspace.";
  };
  const extract = async () => {
    if (!draft) throw new Error("Capture a receipt first.");
    const files = await uploadDraftFiles(props, draft.id, request);
    const result = await request<{
      id: string;
      extractedData: Record<string, unknown> | null;
      errorMessage?: string;
      processing?: boolean;
    }>(`/workspaces/${workspaceId}/books/receipts/extract`, {
      method: "POST",
      body: { fileId: files[0].fileId },
      idempotencyKey: await nativeOperation(userId, `${draft.id}:ocr`),
    });
    await writeState(`ocr:${draft.id}`, result);
    setExtraction(result);
    return "Extraction ready for review. Check every amount and date before applying.";
  };
  const save = async () => {
    if (!draft) throw new Error("Capture a receipt first.");
    if (mode === "attachment") {
      if (!target.trim())
        throw new Error("Choose the existing transaction. Attachments require an online save.");
      const attempted = await readState<string>(`attachment-target:${draft.id}`);
      if (attempted && attempted !== target)
        throw new Error(
          "This capture is already bound to another transaction. Retry that attachment or capture a new original.",
        );
      await writeState(`attachment-target:${draft.id}`, target);
      const files = await uploadDraftFiles(props, draft.id, request);
      await request(`/workspaces/${workspaceId}/books/transactions/${encodeURIComponent(target)}`, {
        method: "PATCH",
        body: { receiptFileId: files[0].fileId },
        idempotencyKey: await nativeOperation(userId, `${draft.id}:attach`),
      });
      await markDraftSynced(props, draft.id);
    } else {
      receiptCurrency(currency);
      if (
        !description.trim() ||
        !Number.isFinite(Number(amount)) ||
        Number(amount) <= 0 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date)
      )
        throw new Error("Enter a description, positive amount and YYYY-MM-DD date.");
      if (
        draft.status === "blocked" &&
        draft.validationRejected === true &&
        draft.uncertainOutcome === false
      ) {
        setDraft(await correctRejectedDraft(props, draft.id, body()));
      } else await updateDraft(props, draft.id, body());
      await explicitSave(props, draft.id);
      await syncOutbox(props, request);
      const latest = await getDraft(props, draft.id);
      if (latest.status !== "synced") {
        setDraft(latest);
        return latest.validationRejected
          ? "The server rejected this expense before saving. Correct its fields and save again; the original capture is retained."
          : "Saved in Drafts. The upload could not complete; your original and expense are retained for retry.";
      }
    }
    setDraft(null);
    onSaved?.();
    return mode === "expense" ? "Expense saved." : "Receipt attached to the existing transaction.";
  };
  const applyOCR = async () => {
    if (!draft || !extraction) throw new Error("Extract and review the receipt first.");
    receiptCurrency(currency);
    if (!description.trim() || Number(amount) <= 0)
      throw new Error("Review the description and amount first.");
    await request(`/workspaces/${workspaceId}/books/receipts/${extraction.id}/apply`, {
      method: "POST",
      body: body(),
      idempotencyKey: await nativeOperation(userId, `${draft.id}:apply`),
    });
    await markDraftSynced(props, draft.id);
    setDraft(null);
    setExtraction(null);
    onSaved?.();
    return "Reviewed extraction applied to a new expense.";
  };
  return (
    <NativePage title="Capture a receipt">
      <Note>
        Files stay on this device until you choose Save or online extraction. Creating a new expense
        and attaching a receipt are separate actions.
      </Note>
      <Status operation={op} />
      {draft?.kind === "receipt-recovered" && (
        <Note>
          Recovered original with no saved transaction details. Check existing records and review
          every field before saving.
        </Note>
      )}
      {!draft && (
        <>
          <Action
            title={
              mode === "expense"
                ? "Mode: new expense — switch to attachment"
                : "Mode: attach existing — switch to new expense"
            }
            onPress={() => setMode(mode === "expense" ? "attachment" : "expense")}
          />
          {(["camera", "library", "document"] as const).map((source) => (
            <Action
              key={source}
              title={
                source === "camera"
                  ? "Take photo"
                  : source === "library"
                    ? "Choose image"
                    : "Choose image or PDF"
              }
              disabled={op.busy}
              onPress={() => void run(() => capture(source))}
            />
          ))}
        </>
      )}
      {draft && (
        <>
          <Note>Saved locally: {draft.files[0].name}</Note>
          {draft.files[0].mimeType.startsWith("image/") && (
            <Image
              accessibilityLabel="Captured receipt preview"
              source={{ uri: draft.files[0].uri }}
              style={{ height: 240, borderRadius: 12 }}
              resizeMode="contain"
            />
          )}
          <Action
            title="Share original"
            disabled={op.busy}
            onPress={() =>
              void run(async () => {
                if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is unavailable.");
                await Sharing.shareAsync(draft.files[0].uri, { mimeType: draft.files[0].mimeType });
              })
            }
          />
          {mode === "attachment" ? (
            <>
              <Note>
                Choose the existing transaction to attach this receipt. This action requires an
                online connection.
              </Note>
              {transactionsLoading && (
                <ActivityIndicator accessibilityLabel="Loading transactions" />
              )}
              {transactionError && <Note error>{transactionError}</Note>}
              {transactions.map((transaction) => (
                <Action
                  key={transaction.id}
                  title={`${target === transaction.id ? "✓ " : ""}${transaction.description} · ${new Intl.NumberFormat("en-AU", { style: "currency", currency: transaction.currency ?? "AUD" }).format(transaction.amountCents / 100)} · ${String(transaction.date).slice(0, 10)}`}
                  disabled={op.busy}
                  onPress={() => setTarget(transaction.id)}
                />
              ))}
              {!transactions.length && !transactionError && (
                <Note>No transactions are available. Create the existing record online first.</Note>
              )}
              <Action
                title={transactionCursor ? "Load more transactions" : "Refresh transactions"}
                disabled={transactionsLoading || op.busy}
                onPress={() => void loadTransactions(transactionCursor)}
              />
            </>
          ) : (
            <>
              <Field label="Description / merchant" value={description} onChange={setDescription} />
              <Field label={`Total (${currency})`} value={amount} onChange={setAmount} numeric />
              <Field
                label="Original currency"
                value={currency}
                onChange={(value) => {
                  currencyChosen.current = true;
                  setCurrency(value.toUpperCase());
                }}
              />
              {RECEIPT_CURRENCIES.map((code) => (
                <Action
                  key={code}
                  title={`${currency === code ? "✓ " : ""}${code}`}
                  disabled={op.busy}
                  onPress={() => {
                    currencyChosen.current = true;
                    setCurrency(code);
                  }}
                />
              ))}
              <Note>
                Amounts remain in the selected original currency. No exchange conversion is applied.
              </Note>
              <Field label="Date (YYYY-MM-DD)" value={date} onChange={setDate} />
              <Note>Expense category: {category}</Note>
              {expenseCategories.map((item) => (
                <Action
                  key={item}
                  title={item.replaceAll("_", " ")}
                  onPress={() => setCategory(item)}
                  disabled={op.busy}
                />
              ))}
              <Action
                title="Extract receipt online — review required"
                disabled={op.busy || !!extraction}
                onPress={() => void run(extract)}
              />
              {extraction && (
                <>
                  <Note>
                    {extraction.processing
                      ? "Receipt extraction is processing online…"
                      : (extraction.errorMessage ??
                        JSON.stringify(extraction.extractedData, null, 2))}
                  </Note>
                  {extractionError && <Note error>{extractionError}</Note>}
                  <Action
                    disabled={op.busy || !!extraction.processing || !extraction.extractedData}
                    title="Copy extracted values into review fields"
                    onPress={() =>
                      void run(async () => {
                        const values = extraction.extractedData;
                        if (!values) return;
                        const reviewed = receiptReviewFields(values);
                        currencyChosen.current = true;
                        setCurrency(reviewed.currency);
                        setDescription(reviewed.description);
                        setAmount(reviewed.amount);
                        if (reviewed.date) setDate(reviewed.date);
                        if (expenseCategories.includes(String(values.category)))
                          setCategory(String(values.category));
                      })
                    }
                  />
                  <Action
                    title="Apply reviewed extraction as new expense (online)"
                    disabled={op.busy || !!extraction.processing || !extraction.extractedData}
                    onPress={() => void run(applyOCR)}
                  />
                  {!extraction.processing && !extraction.extractedData && (
                    <Action
                      title="Enter expense manually instead"
                      onPress={() => {
                        setExtraction(null);
                        if (draft) void writeState(`ocr:${draft.id}`, null);
                      }}
                    />
                  )}
                </>
              )}
            </>
          )}
          <Action
            title={mode === "attachment" ? "Attach to existing record online" : "Save new expense"}
            disabled={op.busy || !!extraction}
            onPress={() => void run(save)}
          />
          <Action
            title="Keep capture in Drafts"
            onPress={() => {
              setDraft(null);
              setExtraction(null);
            }}
            disabled={op.busy}
          />
        </>
      )}
    </NativePage>
  );
}
export function DraftsScreen(props: MobileFeatureProps) {
  return <Drafts key={`${props.userId}:${props.workspaceId}`} {...props} />;
}
function Drafts(incoming: MobileFeatureProps) {
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
export function ShiftScreen(props: MobileFeatureProps) {
  return <Shift key={`${props.userId}:${props.workspaceId}`} {...props} />;
}
function Shift(incoming: MobileFeatureProps) {
  const [props] = useState(incoming);
  const op = useOperation(),
    [shift, setShift] = useState<ShiftSession | null>(null),
    [loaded, setLoaded] = useState(false),
    [platform, setPlatform] = useState("other"),
    [vehicleId, setVehicleId] = useState(""),
    [vehicles, setVehicles] = useState<{ id: string; name?: string; registration?: string }[]>([]),
    [distance, setDistance] = useState(""),
    [purpose, setPurpose] = useState("");
  const { run } = op;
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const value = await recoverShift(props);
        if (live) {
          setShift(value);
          if (value && ["review", "saved"].includes(value.status))
            setDistance(String(summarizePoints(value.points).distanceMeters / 1000));
        }
      } catch (error) {
        if (live)
          void run(async () => {
            throw error;
          });
      } finally {
        if (live) setLoaded(true);
      }
    };
    void load();
    const timer = setInterval(() => {
      void currentShift(props)
        .then((value) => {
          if (live) setShift(value);
        })
        .catch(() => undefined);
    }, 5000);
    void props
      .request<CollectionPage<{ id: string; name?: string; registration?: string }>>(
        `/workspaces/${props.workspaceId}/drive/vehicles`,
      )
      .then((value) => {
        if (live) setVehicles(value.items);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [props, run]);
  const summary = summarizePoints(shift?.points ?? []);
  const openGigApp = async (platformId: string, status: string, manual: boolean) => {
    const link = gigAppLink(platformId);
    if (!link) return "Shift started. Open your gig app from your home screen.";
    const retained = `${status} (${manual ? "manual distance" : "GPS"})`;
    try {
      await Linking.openURL(link);
      return `Opened the configured ${gigAppLabel(platformId)} link. Your shift remains ${retained}.`;
    } catch {
      return `Could not open ${gigAppLabel(platformId)}. Your shift remains ${retained}; use normal app switching.`;
    }
  };
  const transition = (action: "pause" | "resume" | "stop") =>
    void run(async () => {
      const result = await changeShift(props, action);
      setShift(result);
      if (action === "stop")
        setDistance(String(summarizePoints(result.points).distanceMeters / 1000));
    });
  return (
    <NativePage title="Your shift">
      <Note>
        You control recording. Each reviewed shift creates one mileage record. GPS never determines
        whether a trip is business related.
      </Note>
      <Status operation={op} />
      {!loaded ? (
        <ActivityIndicator />
      ) : !shift || shift.status === "saved" ? (
        <>
          <Note>Choose the platform and vehicle used for the whole shift.</Note>
          {[
            { id: "uber", name: "Uber" },
            { id: "uber_eats", name: "Uber Eats" },
            { id: "doordash", name: "DoorDash" },
            { id: "airtasker", name: "Airtasker" },
            { id: "menulog", name: "Menulog" },
            { id: "lyft", name: "Lyft" },
            { id: "instacart", name: "Instacart" },
            { id: "other", name: "Other" },
          ].map((item) => (
            <Action
              key={item.id}
              title={`${platform === item.id ? "✓ " : ""}${item.name}`}
              onPress={() => setPlatform(item.id)}
            />
          ))}
          {vehicles.map((vehicle) => (
            <Action
              key={vehicle.id}
              title={`${vehicleId === vehicle.id ? "✓ " : ""}${vehicle.name ?? vehicle.registration ?? "Business vehicle"}`}
              onPress={() => setVehicleId(vehicle.id)}
            />
          ))}
          {vehicles.length === 0 && <Note>Add a vehicle online in Drive before starting.</Note>}
          <Action
            title="Start GPS shift"
            disabled={op.busy}
            onPress={() =>
              void run(async () => {
                try {
                  const started = await startShift(props, platform, vehicleId);
                  setShift(started);
                  return await openGigApp(started.platform, started.status, started.manual);
                } finally {
                  setShift(await currentShift(props));
                }
              })
            }
          />
          <Action
            title="Start manual shift"
            disabled={op.busy}
            onPress={() =>
              void run(async () => {
                const started = await startShift(props, platform, vehicleId, true);
                setShift(started);
                return await openGigApp(started.platform, started.status, started.manual);
              })
            }
          />
        </>
      ) : (
        <>
          <Note>
            Tracking: {shift.status} · {shift.manual ? "manual distance" : "GPS"} ·{" "}
            {shift.platform.replaceAll("_", " ")}
          </Note>
          <Note>
            Vehicle:{" "}
            {vehicles.find((vehicle) => vehicle.id === shift.vehicleId)?.name ??
              "Selected business vehicle"}
          </Note>
          <Note>Measured distance: {(summary.distanceMeters / 1000).toFixed(2)} km</Note>
          <Note>
            Last sample:{" "}
            {summary.lastSample ? new Date(summary.lastSample).toLocaleString() : "No samples yet"}
          </Note>
          <Note>
            Detected gaps: {summary.gaps}. Pauses and missing or inaccurate samples are excluded.
            Correct the reviewed distance for any missing travel.
          </Note>
          {shift.error && <Note error>{shift.error}</Note>}
          {["recording", "paused"].includes(shift.status) && gigAppLink(shift.platform) && (
            <Action
              title={`Open ${gigAppLabel(shift.platform)} app`}
              disabled={op.busy}
              onPress={() => void run(() => openGigApp(shift.platform, shift.status, shift.manual))}
            />
          )}
          {shift.status === "recording" && (
            <Action
              title="Pause recording"
              disabled={op.busy}
              onPress={() => transition("pause")}
            />
          )}
          {shift.status === "paused" && (
            <>
              <Action
                title="Resume recording"
                disabled={op.busy}
                onPress={() => transition("resume")}
              />
              <Action
                title="Continue with manual distance"
                disabled={op.busy}
                onPress={() =>
                  void run(async () => {
                    setShift(await continueManualShift(props));
                  })
                }
              />
            </>
          )}
          {["recording", "paused"].includes(shift.status) && (
            <Action
              title="Stop & review shift"
              disabled={op.busy}
              onPress={() => transition("stop")}
            />
          )}
          {shift.status === "review" && (
            <>
              <Field
                label="Reviewed total distance (km)"
                value={distance}
                onChange={setDistance}
                numeric
              />
              <Field
                label="Business purpose — your assessment"
                value={purpose}
                onChange={setPurpose}
              />
              <Action
                title="Save reviewed mileage"
                disabled={op.busy}
                onPress={() =>
                  void run(async () => {
                    await saveReviewedShift(props, Math.round(Number(distance) * 1000), purpose);
                    const report = await syncOutbox(props, props.request);
                    setShift(await currentShift(props));
                    props.onSaved?.();
                    return report.failed
                      ? "Mileage queued in Drafts; retry when online."
                      : "Reviewed mileage saved.";
                  })
                }
              />
              <Action
                title="Sync precise route privately (requires opt in)"
                disabled={op.busy}
                onPress={() =>
                  void run(async () => {
                    const preferences = await props.request<MobilePreferences>("/me/preferences");
                    await syncPrivateRoute(props, props.request, preferences.routeSyncEnabled);
                    return "Private route synced to your account.";
                  })
                }
              />
              <Action
                title="Delete precise route from all devices"
                disabled={op.busy}
                onPress={() =>
                  void run(async () => {
                    await deletePrivateRoute(props, props.request);
                    setShift(await currentShift(props));
                    return "Route deletion recorded.";
                  })
                }
              />
            </>
          )}
        </>
      )}
      <Note>
        Automatic app detection is off. Starting a shift may open your selected gig app when an app
        link is available. You can also switch apps yourself. App launch failure does not stop your
        shift.
      </Note>
      <Action title="Open device app settings" onPress={() => void Linking.openSettings()} />
      <Note>
        iPhone Shortcuts: create a shortcut with Open URLs → soletrade://feature/shift. Name it “Start
        Shift”. It opens this screen; you choose the vehicle and confirm Start. Android: add the
        Soletrade quick actions widget from your launcher’s Widgets menu.
      </Note>
    </NativePage>
  );
}
export function DeviceSettingsScreen(props: MobileFeatureProps) {
  return <DeviceSettings key={`${props.userId}:${props.workspaceId}`} {...props} />;
}
function DeviceSettings(incoming: MobileFeatureProps) {
  const [props] = useState(incoming);
  const op = useOperation(),
    [preferences, setPreferences] = useState<MobilePreferences | null>(null),
    [locked, setLocked] = useState(false),
    [start, setStart] = useState("22"),
    [end, setEnd] = useState("7"),
    [routes, setRoutes] = useState<PrivateRouteHistory[]>([]),
    [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const { run } = op;
  useEffect(() => {
    void run(async () => {
      const value = await props.request<MobilePreferences>("/me/preferences");
      setPreferences(value);
      setDeviceNotificationPreferences(value);
      setStart(String(value.quietHoursStart));
      setEnd(String(value.quietHoursEnd));
      setLocked(await appLockEnabled(props.userId));
      await reconcileRouteDeletions(props, props.request);
      setRoutes(await listPrivateRouteHistory(props));
    });
  }, [props, run]);
  const save = async (next: MobilePreferences) => {
    const value = await props.request<MobilePreferences>("/me/preferences", {
      method: "PATCH",
      body: next,
    });
    setPreferences(value);
    setDeviceNotificationPreferences(value);
    await writeState(`preferences:${props.userId}`, value);
    return "Preferences saved.";
  };
  return (
    <NativePage title="Device & privacy">
      <Status operation={op} />
      {!preferences ? (
        <>
          <Note>
            Connect to load your preferences. GPS sync defaults off; quiet hours default to
            22:00–07:00.
          </Note>
          <Action
            title="Retry preferences"
            onPress={() =>
              void run(async () => {
                setPreferences(await props.request("/me/preferences"));
              })
            }
          />
        </>
      ) : (
        <>
          <Host matchContents>
            <Switch
              label="Sync precise routes to my private account"
              value={preferences.routeSyncEnabled}
              disabled={op.busy}
              onValueChange={(value) =>
                void run(() => save({ ...preferences, routeSyncEnabled: value }))
              }
            />
          </Host>
          <Note>
            Precise routes are private to you. Workspace members receive reviewed mileage only.
            Turning sync off does not delete previously uploaded routes.
          </Note>
          <Field
            label="Quiet hours start (local hour 0–23)"
            value={start}
            onChange={setStart}
            numeric
          />
          <Field label="Quiet hours end (local hour 0–23)" value={end} onChange={setEnd} numeric />
          <Action
            title="Save local quiet hours"
            disabled={op.busy}
            onPress={() =>
              void run(async () => {
                const a = Number(start),
                  b = Number(end);
                if (
                  !Number.isInteger(a) ||
                  !Number.isInteger(b) ||
                  a < 0 ||
                  a > 23 ||
                  b < 0 ||
                  b > 23
                )
                  throw new Error("Use whole hours from 0 to 23.");
                return save({ ...preferences, quietHoursStart: a, quietHoursEnd: b });
              })
            }
          />
          {DEFAULT_MOBILE_PREFERENCES.notificationCategories.map((category) => (
            <Host matchContents key={category}>
              <Switch
                label={category}
                value={preferences.notificationCategories.includes(category)}
                disabled={op.busy}
                onValueChange={(value) =>
                  void run(() =>
                    save({
                      ...preferences,
                      notificationCategories: value
                        ? [...preferences.notificationCategories, category]
                        : preferences.notificationCategories.filter((item) => item !== category),
                    }),
                  )
                }
              />
            </Host>
          ))}
        </>
      )}
      {routes.map((route) => (
        <View key={route.id} style={{ gap: 8 }}>
          <Note>
            Private route · {new Date(route.startedAt).toLocaleString()} ·{" "}
            {route.deleted ? "deleted" : `${route.pointCount} samples`}
          </Note>
          {!route.deleted && (
            <>
              <Action
                title="Review private route map"
                onPress={() => setSelectedRoute(selectedRoute === route.id ? null : route.id)}
              />
              {selectedRoute === route.id && (
                <PrivateRouteMap
                  key={route.id}
                  userId={props.userId}
                  workspaceId={props.workspaceId}
                  routeId={route.id}
                />
              )}
              {!route.remote && (
                <Action
                  title="Sync this private route"
                  disabled={op.busy}
                  onPress={() =>
                    void run(async () => {
                      const current = await props.request<MobilePreferences>("/me/preferences");
                      await syncPrivateRoute(
                        props,
                        props.request,
                        current.routeSyncEnabled,
                        route.id,
                      );
                      return "Private route synced.";
                    })
                  }
                />
              )}
              <Action
                title="Delete this route on all devices"
                disabled={op.busy}
                onPress={() =>
                  void run(async () => {
                    try {
                      await deletePrivateRoute(props, props.request, route.id);
                    } finally {
                      setRoutes(await listPrivateRouteHistory(props));
                    }
                    return "Route deleted.";
                  })
                }
              />
            </>
          )}
        </View>
      ))}
      <Action
        title="Enable notifications on this device"
        disabled={op.busy}
        onPress={() =>
          void run(async () => {
            await registerPush(props.request, props.userId);
            return "This device is registered for your selected notifications.";
          })
        }
      />
      <Action
        title="Unregister device notifications"
        disabled={op.busy}
        onPress={() =>
          void run(async () => {
            await unregisterPush(props.request, props.userId);
            return "This device was unregistered.";
          })
        }
      />
      <Note>
        Push is a reminder. Open the app to see the current record. Background alerts are suppressed
        by the server using your saved local quiet hours.
      </Note>
      <Host matchContents>
        <Switch
          label="Require biometrics to unlock Soletrade"
          value={locked}
          disabled={op.busy}
          onValueChange={(value) =>
            void run(async () => {
              await configureAppLock(props.userId, value);
              setLocked(value);
            })
          }
        />
      </Host>
      <Action
        title="Show this workspace on home screen widget"
        disabled={op.busy}
        onPress={() =>
          void run(async () => {
            await configureWidget(props, false);
            return "Widget bound to this workspace. Open Home to refresh its last-synced overview.";
          })
        }
      />
      <Action
        title="Hide widget business information"
        disabled={op.busy}
        onPress={() =>
          void run(async () => {
            await configureWidget(props, true);
            await clearWidgets();
            return "Business details hidden.";
          })
        }
      />
      <Note>
        Widgets show a snapshot and its sync time. iOS widget actions open the app for receipt
        capture or Start Shift. Android provides a separate Soletrade quick actions widget for receipt
        capture, Start Shift and a new invoice. You can also press and hold the app icon for quick
        actions. Start and stop each shift explicitly and review its distance before saving.
      </Note>
      <Note>
        Background location can be interrupted by device battery settings, force quit or permission
        changes. Always review the distance before saving.
      </Note>
    </NativePage>
  );
}
