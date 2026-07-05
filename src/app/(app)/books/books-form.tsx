"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { categoriesForType } from "@/shared/constants/books-categories";
import {
  createTransactionAction,
  updateTransactionAction,
  type CreateTransactionResult,
  type UpdateTransactionResult,
} from "./actions";
import type { CustomerRow } from "@/platform/customers";
import type { TransactionRow } from "@/modules/books";
import type { BookType } from "@/server/db/schema/enums";

type Result = CreateTransactionResult | UpdateTransactionResult;

function dollarsToCents(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
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
}: {
  mode: "create" | "edit";
  tx?: TransactionRow;
  customers: CustomerRow[];
}) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const [isPending, startTransition] = useTransition();
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
      currency: "AUD" as string,
      date: new Date(date),
      description: description.trim(),
      category,
      customerId: customerId || null,
      notes: notes || null,
    };

    startTransition(async () => {
      const res: Result =
        isEdit && tx
          ? await updateTransactionAction({ transactionId: tx.id, ...input })
          : await createTransactionAction(input);
      if (res.ok) {
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
          <Label htmlFor="amountDollars">Amount</Label>
          <Input
            id="amountDollars"
            name="amountDollars"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            required
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
          <select
            id="customerId"
            name="customerId"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">None</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.company ? ` · ${c.company}` : ""}
              </option>
            ))}
          </select>
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
