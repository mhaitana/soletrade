"use client";

import { useState, useTransition } from "react";
import { useRequestId } from "@/hooks/use-request-id";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { categoriesForType } from "@/config/books-categories";
import {
  createTransactionAction,
  updateTransactionAction,
  type CreateTransactionResult,
  type UpdateTransactionResult,
} from "@/features/books/api/actions";
import { ReceiptUpload } from "@/features/books/components/receipt-upload";
import type { PickerCustomer } from "@/types/customer-picker";
import { CustomerCombobox } from "@/components/customer-combobox";
import type { TransactionRow } from "@/lib/domain/books/types";
import type { BookType } from "@/lib/domain/database-enums";
import type { FileId } from "@/types/ids";
import {
  HaiPrefillNotice,
  fieldBoolean,
  fieldNumber,
  fieldString,
  resolvePickerId,
  useHaiFormPrefill,
} from "@/components/assisted-form/hai-form-prefill";

const TRANSACTION_SAVE_UNCONFIRMED =
  "We couldn’t confirm whether this transaction was saved. Saving again is safe: it won’t create a copy.";

type Result = CreateTransactionResult | UpdateTransactionResult;

function dollarsToCents(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/** Default AU GST rate (10%). Hardcoded for now - no workspace GST-rate setting exists. */
const GST_RATE = 10;

/**
 * Compute the GST portion (in dollars) for a given amount (in dollars) at the
 * default AU rate: `gstCents = Math.round(amountCents * GST_RATE / 100)`. Returns
 * "" when the amount is empty/invalid so the input stays placeholder-blank.
 */
function computeGstDollars(amountDollars: string): string {
  const cents = dollarsToCents(amountDollars);
  if (cents <= 0) return "";
  const gstCents = Math.round((cents * GST_RATE) / 100);
  return (gstCents / 100).toFixed(2);
}

function isoDate(d: Date | null | undefined): string {
  if (!d) return "";
  // toISOString gives UTC; we want the calendar date the user saved, so slice the
  // date part off the ISO string (the input is type=date, value is yyyy-mm-dd).
  return d.toISOString().slice(0, 10);
}

export function BookForm({
  mode,
  tx,
  customers,
  defaultCurrency,
}: {
  mode: "create" | "edit";
  tx?: TransactionRow;
  customers: PickerCustomer[];
  defaultCurrency: string;
}) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const [isPending, startTransition] = useTransition();
  const { requestId } = useRequestId();
  const [error, setError] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();

  const [type, setType] = useState<BookType>(tx?.type ?? "income");
  const [amountDollars, setAmountDollars] = useState<string>(
    tx ? (tx.amountCents / 100).toFixed(2) : "",
  );
  const [date, setDate] = useState<string>(isoDate(tx?.date) || isoDate(new Date()));
  const [description, setDescription] = useState<string>(tx?.description ?? "");
  // If the existing category isn't valid for the current type (e.g. type changed in
  // state), fall back to the first category for the type so the select always has a
  // valid value.
  const initialCategory =
    tx && categoriesForType(tx.type).some((c) => c.key === tx.category)
      ? tx.category
      : categoriesForType(tx?.type ?? "income")[0]!.key;
  const [category, setCategory] = useState<string>(initialCategory);
  const [customerId, setCustomerId] = useState<string>(tx?.customerId ?? "");
  const [notes, setNotes] = useState<string>(tx?.notes ?? "");
  // Receipt link (Phase 11b). Null = no receipt; a FileId = uploaded + linked.
  const [receiptFileId, setReceiptFileId] = useState<FileId | null>(tx?.receiptFileId ?? null);
  // GST (Wave 2). "GST included" toggle + a numeric GST amount input (in dollars). When
  // the toggle is on, the GST amount auto-computes from the transaction amount at 10% -
  // the user can override the input for edge cases (mixed / different-rate supplies).
  const [gstIncluded, setGstIncluded] = useState<boolean>((tx?.gstCents ?? 0) > 0);
  const [gstDollars, setGstDollars] = useState<string>(
    tx && tx.gstCents > 0 ? (tx.gstCents / 100).toFixed(2) : "",
  );

  const haiNotice = useHaiFormPrefill(
    mode === "create" ? "books.transaction.create" : "books.transaction.edit",
    (fields) => {
      const applied: string[] = [];
      const unresolved: string[] = [];
      const requestedType = fieldString(fields, "type");
      const nextType: BookType =
        requestedType === "expense" ? "expense" : requestedType === "income" ? "income" : type;
      if (requestedType === "income" || requestedType === "expense") {
        setType(nextType);
        setCategory(categoriesForType(nextType)[0]!.key);
        applied.push("transaction type");
      }
      const amountCents = fieldNumber(fields, "amountCents");
      if (amountCents !== undefined) {
        setAmountDollars((amountCents / 100).toFixed(2));
        applied.push("amount");
      }
      const nextDate = fieldString(fields, "date");
      if (nextDate) {
        setDate(nextDate);
        applied.push("date");
      }
      const nextDescription = fieldString(fields, "description");
      if (nextDescription) {
        setDescription(nextDescription);
        applied.push("description");
      }
      const nextCategory = fieldString(fields, "category");
      if (nextCategory) {
        if (categoriesForType(nextType).some((entry) => entry.key === nextCategory)) {
          setCategory(nextCategory);
          applied.push("category");
        } else {
          unresolved.push(`category “${nextCategory}” (select a match)`);
        }
      }
      const customerQuery = fieldString(fields, "customerQuery");
      if (customerQuery) {
        const id = resolvePickerId(customerQuery, customers);
        if (id) {
          setCustomerId(id);
          applied.push("customer");
        } else {
          unresolved.push(`customer “${customerQuery}” (select a match)`);
        }
      }
      const nextNotes = fieldString(fields, "notes");
      if (nextNotes !== undefined) {
        setNotes(nextNotes);
        applied.push("notes");
      }
      const nextGstIncluded = fieldBoolean(fields, "gstIncluded");
      const nextGstCents = fieldNumber(fields, "gstCents");
      if (nextGstIncluded !== undefined) {
        setGstIncluded(nextGstIncluded);
        applied.push("GST treatment");
      }
      if (nextGstCents !== undefined) {
        setGstDollars((nextGstCents / 100).toFixed(2));
        applied.push("GST amount");
      } else if (nextGstIncluded && amountCents !== undefined) {
        setGstDollars(computeGstDollars((amountCents / 100).toFixed(2)));
      }
      return { appliedFields: applied, unresolvedFields: unresolved };
    },
  );

  const categories = categoriesForType(type);

  function onTypeChange(next: BookType) {
    setType(next);
    // The category list differs per type; reset to the first valid category so the
    // select never shows a stale / invalid option.
    setCategory(categoriesForType(next)[0]!.key);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setFieldErrors(undefined);

    const input = {
      type,
      amountCents: dollarsToCents(amountDollars),
      currency: tx?.currency ?? defaultCurrency,
      date: new Date(date),
      description: description.trim(),
      category,
      customerId: customerId || null,
      notes: notes || null,
      receiptFileId,
      gstCents: gstIncluded ? dollarsToCents(gstDollars) : 0,
    };

    startTransition(async () => {
      let res: Result;
      try {
        res =
          isEdit && tx
            ? await updateTransactionAction({ transactionId: tx.id, ...input })
            : await createTransactionAction({ requestId, ...input });
      } catch {
        setError(TRANSACTION_SAVE_UNCONFIRMED);
        return;
      }
      if (res.ok) {
        toast.success(isEdit ? "Transaction updated" : "Transaction added");
        router.push("/books");
        router.refresh();
        return;
      }
      setError(res.error);
      setFieldErrors(res.fieldErrors);
    });
  }

  const fieldErr = (name: string) => fieldErrors?.[name]?.[0];

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <HaiPrefillNotice notice={haiNotice} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="type">Type</Label>
          <select
            id="type"
            name="type"
            value={type}
            onChange={(e) => onTypeChange(e.target.value as BookType)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="amountDollars">Amount ({tx?.currency ?? defaultCurrency})</Label>
          <Input
            id="amountDollars"
            name="amountDollars"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            required
            value={amountDollars}
            onChange={(e) => {
              setAmountDollars(e.target.value);
              // Keep the GST field in sync with the amount while GST is included
              // so the auto-computed 10% tracks the amount unless the user overrides it.
              if (gstIncluded) setGstDollars(computeGstDollars(e.target.value));
            }}
            aria-invalid={Boolean(fieldErr("amountCents"))}
            className="tabular-nums"
          />
          {fieldErr("amountCents") ? (
            <p className="text-sm text-destructive">{fieldErr("amountCents")}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="date">Date</Label>
          <Input
            id="date"
            name="date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-invalid={Boolean(fieldErr("date"))}
          />
          {fieldErr("date") ? <p className="text-sm text-destructive">{fieldErr("date")}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="category">Category</Label>
          <select
            id="category"
            name="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-invalid={Boolean(fieldErr("category"))}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          {fieldErr("category") ? (
            <p className="text-sm text-destructive">{fieldErr("category")}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="customerId">Customer</Label>
          <CustomerCombobox
            id="customerId"
            name="customerId"
            customers={customers}
            value={customerId}
            onValueChange={setCustomerId}
            noneLabel="None"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gstIncluded">GST included</Label>
          <label className="flex h-10 items-center gap-2 text-sm">
            <input
              id="gstIncluded"
              name="gstIncluded"
              type="checkbox"
              className="size-4 rounded border-input"
              checked={gstIncluded}
              onChange={(e) => {
                const next = e.target.checked;
                setGstIncluded(next);
                if (next) setGstDollars(computeGstDollars(amountDollars));
              }}
            />
            <span className="text-muted-foreground">10% AU GST</span>
          </label>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gstDollars">GST amount</Label>
          <Input
            id="gstDollars"
            name="gstDollars"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={gstDollars}
            onChange={(e) => setGstDollars(e.target.value)}
            disabled={!gstIncluded}
            placeholder={gstIncluded ? "0.00" : "-"}
            aria-invalid={Boolean(fieldErr("gstCents"))}
            className="tabular-nums"
          />
          {fieldErr("gstCents") ? (
            <p className="text-sm text-destructive">{fieldErr("gstCents")}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          name="description"
          required
          maxLength={280}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-invalid={Boolean(fieldErr("description"))}
          placeholder="What was this transaction for?"
        />
        {fieldErr("description") ? (
          <p className="text-sm text-destructive">{fieldErr("description")}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Internal notes (not shown anywhere publicly)."
          className="flex min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <ReceiptUpload
        initialFileId={tx?.receiptFileId ?? null}
        initialFileName={tx?.receiptFileId ? "Receipt" : null}
        onChange={setReceiptFileId}
      />

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : isEdit ? "Save changes" : "Record transaction"}
        </Button>
        <Button asChild type="button" variant="outline">
          <Link href="/books">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
