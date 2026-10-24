import { Action, Field, NativePage, Note } from "@/components/native-ui";
import { Status, useOperation } from "@/components/operation";
import {
  RECEIPT_CURRENCIES,
  receiptCurrency,
  receiptReviewFields,
} from "@/features/receipts/lib/receipt-policy";
import {
  correctRejectedDraft,
  createDraft,
  durableFile,
  explicitSave,
  getDraft,
  markDraftSynced,
  nativeOperation,
  readReference,
  readState,
  syncOutbox,
  updateDraft,
  uploadDraftFiles,
  writeState,
  type Draft,
} from "@/lib/offline/store";
import type { CollectionPage, MobileBootstrap, MobileFeatureProps } from "@soletrade/contracts";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image } from "react-native";

export const expenseCategories = [
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

export function ReceiptCapture(incoming: MobileFeatureProps & { initialDraft?: Draft }) {
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
