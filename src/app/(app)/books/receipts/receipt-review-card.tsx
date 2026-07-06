"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { categoriesForType } from "@/shared/constants/books-categories";
import {
  applyExtractionAction,
  rejectExtractionAction,
  type ApplyExtractionResult,
  type RejectExtractionResult,
} from "./actions";

/**
 * Serializable subset of `ExtractionRow` passed from the server `receipts/page.tsx`.
 * The full `ExtractionRow` type lives in a `server-only` module, so the client
 * component defines its own prop shape — `Date` fields serialize fine over the
 * RSC boundary (Next serializes Dates as ISO strings; here `createdAt` is only
 * used for display via the server-rendered page, so the card itself doesn't need it).
 */
export interface ReceiptReviewProps {
  id: string;
  status: "pending" | "reviewed" | "applied" | "rejected";
  extractedData: {
    merchant: string;
    date: string;
    totalCents: number;
    taxCents: number;
    currency: string;
    category: string;
    confidence: number;
    lineItems: Array<{
      description: string;
      quantity: number;
      unitPriceCents: number;
      amountCents: number;
    }>;
  } | null;
  errorMessage: string | null;
}

function dollarsToCents(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function centsToDollars(cents: number): string {
  if (cents <= 0) return "";
  return (cents / 100).toFixed(2);
}

function isoDate(iso: string): string {
  // The extracted data carries a "YYYY-MM-DD" (or full ISO) string; the date input
  // wants the calendar-date portion. Slice defensively.
  return iso ? iso.slice(0, 10) : "";
}

/**
 * Review card for a single extraction: editable fields pre-filled from the model
 * output, with Apply (creates a `book_transactions` row) and Reject buttons. Mirrors
 * `book-detail-actions.tsx` — `useTransition` for the pending state, local error
 * state, fail-closed on the server action's `manage:books` gate.
 */
export function ReceiptReviewCard({ extraction }: { extraction: ReceiptReviewProps }) {
  const data = extraction.extractedData;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();

  // Editable reviewer fields. Default `type` to "expense" — receipts are almost
  // always expenses; the model's `category` is an expense slug, so this stays valid.
  const [type, setType] = useState<"income" | "expense">("expense");
  const [amountDollars, setAmountDollars] = useState<string>(
    data ? centsToDollars(data.totalCents) : "",
  );
  const [gstDollars, setGstDollars] = useState<string>(data ? centsToDollars(data.taxCents) : "");
  const [currency, setCurrency] = useState<string>(data?.currency ?? "AUD");
  const [date, setDate] = useState<string>(
    data ? isoDate(data.date) : isoDate(new Date().toISOString()),
  );
  const [description, setDescription] = useState<string>(data?.merchant ?? "");
  // The model returns an expense category slug; if it isn't valid for the current
  // type, fall back to the first category for that type.
  const initialCategory =
    data && categoriesForType(type).some((c) => c.key === data.category)
      ? data.category
      : categoriesForType(type)[0]!.key;
  const [category, setCategory] = useState<string>(initialCategory);

  const categories = categoriesForType(type);

  function onTypeChange(next: "income" | "expense") {
    setType(next);
    setCategory(categoriesForType(next)[0]!.key);
  }

  function onApply() {
    setError("");
    setFieldErrors(undefined);
    startTransition(async () => {
      const res: ApplyExtractionResult = await applyExtractionAction({
        extractionId: extraction.id,
        type,
        amountCents: dollarsToCents(amountDollars),
        gstCents: dollarsToCents(gstDollars),
        currency,
        date: new Date(date),
        description: description.trim(),
        category,
      });
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors);
      }
    });
  }

  function onReject() {
    setError("");
    setFieldErrors(undefined);
    startTransition(async () => {
      const res: RejectExtractionResult = await rejectExtractionAction({
        extractionId: extraction.id,
      });
      if (!res.ok) setError(res.error);
    });
  }

  const fieldErr = (name: string) => fieldErrors?.[name]?.[0];
  const lowConfidence = data ? data.confidence < 0.7 : false;

  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">
            {data?.merchant ?? "Unknown merchant"}
          </span>
          {data ? (
            <Badge variant={lowConfidence ? "destructive" : "secondary"}>
              {lowConfidence
                ? "Low confidence"
                : `Confidence ${Math.round(data.confidence * 100)}%`}
            </Badge>
          ) : null}
        </div>
        {extraction.errorMessage ? (
          <span className="text-xs text-destructive">{extraction.errorMessage}</span>
        ) : null}
      </div>

      {data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`type-${extraction.id}`}>Type</Label>
            <select
              id={`type-${extraction.id}`}
              value={type}
              onChange={(e) => onTypeChange(e.target.value as "income" | "expense")}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`amount-${extraction.id}`}>Amount</Label>
            <Input
              id={`amount-${extraction.id}`}
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={amountDollars}
              onChange={(e) => setAmountDollars(e.target.value)}
              aria-invalid={Boolean(fieldErr("amountCents"))}
              className="tabular-nums"
            />
            {fieldErr("amountCents") ? (
              <p className="text-sm text-destructive">{fieldErr("amountCents")}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`gst-${extraction.id}`}>GST</Label>
            <Input
              id={`gst-${extraction.id}`}
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={gstDollars}
              onChange={(e) => setGstDollars(e.target.value)}
              aria-invalid={Boolean(fieldErr("gstCents"))}
              className="tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`currency-${extraction.id}`}>Currency</Label>
            <Input
              id={`currency-${extraction.id}`}
              type="text"
              minLength={3}
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`date-${extraction.id}`}>Date</Label>
            <Input
              id={`date-${extraction.id}`}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-invalid={Boolean(fieldErr("date"))}
            />
            {fieldErr("date") ? (
              <p className="text-sm text-destructive">{fieldErr("date")}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`category-${extraction.id}`}>Category</Label>
            <select
              id={`category-${extraction.id}`}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`description-${extraction.id}`}>Description</Label>
            <Input
              id={`description-${extraction.id}`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={280}
              aria-invalid={Boolean(fieldErr("description"))}
            />
            {fieldErr("description") ? (
              <p className="text-sm text-destructive">{fieldErr("description")}</p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No extracted data — enter the transaction manually on the Books page.
        </p>
      )}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="button" onClick={onApply} disabled={isPending || !data}>
          {isPending ? "Applying…" : "Apply"}
        </Button>
        <Button type="button" variant="outline" onClick={onReject} disabled={isPending}>
          {isPending ? "Working…" : "Reject"}
        </Button>
      </div>
    </div>
  );
}
