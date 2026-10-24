import { Action, Choice, Copy, ErrorNotice, Field, Group } from "@/components/ui";
import { catalog, formBody } from "@/config/resources";
import { nativeOperation } from "@/lib/offline/store";
import { detailHref, type Entity } from "@/lib/resources";
import { useSession } from "@/lib/session";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
export function ReceiptReview({
  receipt,
  onSaved,
}: {
  receipt: Entity;
  onSaved: () => Promise<void>;
}) {
  const { userId, workspaceId } = useSession();
  return (
    <BoundReceiptReview
      key={`${userId}:${workspaceId}:${receipt.id}`}
      receipt={receipt}
      onSaved={onSaved}
    />
  );
}
function BoundReceiptReview({
  receipt,
  onSaved,
}: {
  receipt: Entity;
  onSaved: () => Promise<void>;
}) {
  const { request, userId, workspaceId } = useSession();
  const extracted = useMemo(
    () =>
      receipt.extractedData && typeof receipt.extractedData === "object"
        ? (receipt.extractedData as Record<string, unknown>)
        : {},
    [receipt.extractedData],
  );
  const extractedValues = useMemo(
    () => ({
      type: "expense",
      description: extracted.merchant ?? "",
      amountCents: extracted.totalCents == null ? "" : String(Number(extracted.totalCents) / 100),
      gstCents: extracted.taxCents == null ? "0" : String(Number(extracted.taxCents) / 100),
      date: String(extracted.date ?? new Date().toISOString()).slice(0, 10),
      currency: extracted.currency ?? "AUD",
      category: extracted.category ?? "supplies",
      notes: "",
      customerId: "",
    }),
    [extracted],
  );
  const [values, setValues] = useState<Record<string, unknown>>(extractedValues);
  const dirty = useRef(new Set<string>());
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || receipt.processing || !Object.keys(extracted).length) return;
    hydrated.current = true;
    setValues((previous) => ({
      ...extractedValues,
      ...Object.fromEntries(Object.entries(previous).filter(([key]) => dirty.current.has(key))),
    }));
  }, [receipt.processing, extracted, extractedValues]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key: string, value: unknown) => {
    dirty.current.add(key);
    setValues((previous) => ({ ...previous, [key]: value }));
  };
  const perform = async (action: "review" | "apply" | "reject") => {
    setBusy(true);
    setError("");
    try {
      const body = action === "apply" ? formBody("books/transactions", values) : {};
      const idempotencyKey = await nativeOperation(
        userId,
        `receipt-review:${workspaceId}:${receipt.id}:${action}`,
      );
      const result = await request<{ transactionId?: string }>(
        `/workspaces/${workspaceId}/books/receipts/${receipt.id}/${action}`,
        { method: "POST", body, version: receipt.updatedAt, idempotencyKey },
      );
      await onSaved();
      if (result.transactionId)
        router.push(detailHref("books/transactions", result.transactionId) as never);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not update receipt. Your review is retained.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (receipt.processing)
    return (
      <Group title="Processing receipt">
        <Copy>
          Extraction is in progress. Refresh after processing completes. Your original file is
          already saved.
        </Copy>
        <Action title="Refresh receipt" secondary onPress={() => void onSaved()} />
      </Group>
    );
  if (["applied", "rejected"].includes(String(receipt.status)))
    return receipt.transactionId ? (
      <Action
        title="Open created transaction"
        secondary
        onPress={() =>
          router.push(detailHref("books/transactions", String(receipt.transactionId)) as never)
        }
      />
    ) : null;
  return (
    <Group title="Review extracted expense">
      <Copy muted>
        Check the original receipt and correct every field before creating an expense. This creates
        a new transaction.
      </Copy>
      {typeof extracted.confidence === "number" && (
        <Copy>Extraction confidence: {Math.round(extracted.confidence * 100)}%</Copy>
      )}
      {["description", "amountCents", "gstCents", "date"].map((key) => (
        <Field
          key={key}
          label={
            {
              description: "Description *",
              amountCents: "Total amount *",
              gstCents: "GST included",
              date: "Date (YYYY-MM-DD) *",
            }[key]!
          }
          value={String(values[key] ?? "")}
          onChangeText={(value) => update(key, value)}
          keyboardType={key.endsWith("Cents") ? "decimal-pad" : "default"}
        />
      ))}
      <Choice
        label="Currency"
        value={String(values.currency)}
        options={["AUD", "NZD", "USD", "GBP", "EUR"].map((value) => ({ label: value, value }))}
        onChange={(value) => update("currency", value)}
      />
      <Choice
        label="Category"
        value={String(values.category)}
        options={(
          catalog["books/transactions"].fields?.find((field) => field.key === "category")
            ?.options ?? []
        )
          .filter((value) =>
            [
              "rent",
              "utilities",
              "supplies",
              "travel",
              "wages",
              "software_expense",
              "vehicle_expense",
              "mileage",
              "other_expense",
            ].includes(value),
          )
          .map((value) => ({ label: value.replaceAll("_", " "), value }))}
        onChange={(value) => update("category", value)}
      />
      {error && <ErrorNotice message={error} />}
      <Action
        title="Create expense from reviewed receipt"
        busy={busy}
        onPress={() => void perform("apply")}
      />
      <Action title="Mark reviewed" secondary busy={busy} onPress={() => void perform("review")} />
      <Action
        title="Reject extraction"
        secondary
        busy={busy}
        onPress={() => void perform("reject")}
      />
    </Group>
  );
}
