"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { computeLineItemTotals } from "@/shared/utils/totals";
import {
  createQuoteAction,
  updateQuoteAction,
  type CreateQuoteResult,
  type UpdateQuoteResult,
} from "./actions";
import type { CustomerRow } from "@/platform/customers";
import type { QuoteWithItems } from "@/modules/quotes";

type Result = CreateQuoteResult | UpdateQuoteResult;

interface LineItemState {
  key: string;
  description: string;
  quantity: string;
  unitPriceDollars: string;
}

function dollarsToCents(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function toLineItemInput(items: LineItemState[]) {
  return items.map((it) => ({
    description: it.description.trim(),
    quantity: Number(it.quantity) || 0,
    unitPriceCents: dollarsToCents(it.unitPriceDollars),
  }));
}

function isoDate(d: Date | null | undefined): string {
  if (!d) return "";
  // toISOString gives UTC; we want the calendar date the user saved, so slice the
  // date part off the ISO string (the input is type=date, value is yyyy-mm-dd).
  return d.toISOString().slice(0, 10);
}

export function QuoteForm({
  mode,
  quote,
  customers,
}: {
  mode: "create" | "edit";
  quote?: QuoteWithItems;
  customers: CustomerRow[];
}) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();

  const [customerId, setCustomerId] = useState<string>(quote?.customerId ?? "");
  const [issueDate, setIssueDate] = useState<string>(
    isoDate(quote?.issueDate) || isoDate(new Date()),
  );
  const [validUntil, setValidUntil] = useState<string>(isoDate(quote?.validUntil));
  const [taxRate, setTaxRate] = useState<string>(String(quote?.taxRate ?? 0));
  const [notes, setNotes] = useState<string>(quote?.notes ?? "");

  const [items, setItems] = useState<LineItemState[]>(
    quote
      ? quote.lineItems.map((it) => ({
          key: crypto.randomUUID(),
          description: it.description,
          quantity: String(it.quantity),
          unitPriceDollars: (it.unitPriceCents / 100).toFixed(2),
        }))
      : [{ key: crypto.randomUUID(), description: "", quantity: "1", unitPriceDollars: "" }],
  );

  // Live totals preview from the current line items + tax rate.
  const totals = computeLineItemTotals(
    toLineItemInput(items).map((it) => ({
      quantity: it.quantity,
      unitPriceCents: it.unitPriceCents,
    })),
    Number(taxRate) || 0,
  );

  function updateItem(key: string, patch: Partial<LineItemState>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((prev) => [
      ...prev,
      { key: crypto.randomUUID(), description: "", quantity: "1", unitPriceDollars: "" },
    ]);
  }
  function removeItem(key: string) {
    setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.key !== key) : prev));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setFieldErrors(undefined);

    const lineItemInputs = toLineItemInput(items);
    if (lineItemInputs.length === 0) {
      setError("Add at least one line item.");
      return;
    }
    if (lineItemInputs.some((it) => it.description === "")) {
      setError("Every line item needs a description.");
      return;
    }
    if (lineItemInputs.some((it) => it.quantity <= 0)) {
      setError("Quantity must be greater than 0 for every line item.");
      return;
    }

    const input = {
      customerId: customerId || null,
      issueDate: new Date(issueDate),
      validUntil: validUntil ? new Date(validUntil) : null,
      currency: "AUD" as string,
      taxRate: Number(taxRate) || 0,
      notes: notes || null,
      lineItems: lineItemInputs,
    };

    startTransition(async () => {
      const res: Result =
        isEdit && quote
          ? await updateQuoteAction({ quoteId: quote.id, ...input })
          : await createQuoteAction(input);
      if (res.ok) {
        router.push("/quotes");
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
          <Label htmlFor="customerId">Customer</Label>
          <select
            id="customerId"
            name="customerId"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Walk-in (no customer)</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.company ? ` · ${c.company}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="taxRate">Tax rate (%)</Label>
          <Input
            id="taxRate"
            name="taxRate"
            type="number"
            min={0}
            max={100}
            step={1}
            value={taxRate}
            onChange={(e) => setTaxRate(e.target.value)}
            aria-invalid={Boolean(fieldErr("taxRate"))}
            className="tabular-nums"
          />
          {fieldErr("taxRate") ? (
            <p className="text-sm text-destructive">{fieldErr("taxRate")}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="issueDate">Issue date</Label>
          <Input
            id="issueDate"
            name="issueDate"
            type="date"
            required
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            aria-invalid={Boolean(fieldErr("issueDate"))}
          />
          {fieldErr("issueDate") ? (
            <p className="text-sm text-destructive">{fieldErr("issueDate")}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="validUntil">Valid until</Label>
          <Input
            id="validUntil"
            name="validUntil"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Optional — sent quotes auto-expire past this date.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Line items</h2>
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            <Plus className="size-4" aria-hidden />
            Add line
          </Button>
        </div>
        {fieldErr("lineItems") ? (
          <p className="text-sm text-destructive" role="alert">
            {fieldErr("lineItems")}
          </p>
        ) : null}
        <div className="space-y-2">
          {items.map((it, i) => (
            <div
              key={it.key}
              className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_5rem_7rem_auto]"
            >
              <Input
                aria-label={`Line ${i + 1} description`}
                placeholder="Description"
                value={it.description}
                onChange={(e) => updateItem(it.key, { description: e.target.value })}
              />
              <Input
                aria-label={`Line ${i + 1} quantity`}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder="Qty"
                value={it.quantity}
                onChange={(e) => updateItem(it.key, { quantity: e.target.value })}
                className="tabular-nums"
              />
              <Input
                aria-label={`Line ${i + 1} unit price`}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder="Unit $"
                value={it.unitPriceDollars}
                onChange={(e) => updateItem(it.key, { unitPriceDollars: e.target.value })}
                className="tabular-nums"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove line ${i + 1}`}
                disabled={items.length === 1}
                onClick={() => removeItem(it.key)}
              >
                <Trash2 className="size-4 text-destructive" aria-hidden />
              </Button>
            </div>
          ))}
        </div>
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
          placeholder="Internal notes (not shown to the customer)."
          className="flex min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular-nums">${(totals.subtotalCents / 100).toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Tax ({Number(taxRate) || 0}%)</span>
          <span className="tabular-nums">${(totals.taxCents / 100).toFixed(2)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-base font-medium">
          <span>Total</span>
          <span className="tabular-nums">${(totals.totalCents / 100).toFixed(2)}</span>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : isEdit ? "Save changes" : "Create quote"}
        </Button>
        <Button asChild type="button" variant="outline">
          <Link href="/quotes">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
