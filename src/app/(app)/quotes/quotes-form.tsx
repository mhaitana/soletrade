"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { computeLineItemTotals } from "@/shared/utils/totals";
import { formatCents } from "@/platform/billing/pricing";
import {
  createQuoteAction,
  updateQuoteAction,
  type CreateQuoteResult,
  type UpdateQuoteResult,
} from "./actions";
import { CustomerCreateDialog, type PickerCustomer } from "../customers/customer-create-dialog";
import type { QuoteWithItems } from "@/modules/quotes";
import {
  HaiPrefillNotice,
  fieldBoolean,
  fieldNumber,
  fieldString,
  resolvePickerId,
  useHaiFormPrefill,
} from "@/app/(app)/assistant/hai-form-prefill";

type Result = CreateQuoteResult | UpdateQuoteResult;

const QUOTE_SAVE_UNCONFIRMED = "We couldn’t confirm whether this quote was saved.";

interface LineItemState {
  key: string;
  description: string;
  quantity: string;
  unitPriceDollars: string;
}

interface SectionState {
  key: string;
  title: string;
  body: string;
  optional: boolean;
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
  defaultCurrency,
}: {
  mode: "create" | "edit";
  quote?: QuoteWithItems;
  customers: PickerCustomer[];
  defaultCurrency: string;
}) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();

  // Held in state so the inline "Add customer" dialog can append a newly-created
  // customer and the picker can auto-select it without a round-trip.
  const [customerList, setCustomerList] = useState<PickerCustomer[]>(customers);
  const [customerId, setCustomerId] = useState<string>(quote?.customerId ?? "");
  const [issueDate, setIssueDate] = useState<string>(
    isoDate(quote?.issueDate) || isoDate(new Date()),
  );
  const [validUntil, setValidUntil] = useState<string>(isoDate(quote?.validUntil));
  const [taxRate, setTaxRate] = useState<string>(String(quote?.taxRate ?? 0));
  const [pricesIncludeTax, setPricesIncludeTax] = useState<boolean>(
    quote?.pricesIncludeTax ?? false,
  );
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

  const [sections, setSections] = useState<SectionState[]>(
    quote
      ? quote.sections.map((s) => ({
          key: crypto.randomUUID(),
          title: s.title,
          body: s.body,
          optional: s.optional,
        }))
      : [],
  );

  const [termsConditions, setTermsConditions] = useState<string>(quote?.termsConditions ?? "");

  const haiNotice = useHaiFormPrefill(
    mode === "create" ? "quote.create" : "quote.edit",
    (fields) => {
      const applied: string[] = [];
      const unresolved: string[] = [];
      const customerQuery = fieldString(fields, "customerQuery");
      if (customerQuery) {
        const id = resolvePickerId(customerQuery, customerList);
        if (id) {
          setCustomerId(id);
          applied.push("customer");
        } else {
          unresolved.push(`customer “${customerQuery}” (select a match)`);
        }
      }
      const nextIssueDate = fieldString(fields, "issueDate");
      if (nextIssueDate) {
        setIssueDate(nextIssueDate);
        applied.push("issue date");
      }
      const nextValidUntil = fieldString(fields, "validUntil");
      if (nextValidUntil) {
        setValidUntil(nextValidUntil);
        applied.push("valid-until date");
      }
      const nextTaxRate = fieldNumber(fields, "taxRate");
      if (nextTaxRate !== undefined) {
        setTaxRate(String(nextTaxRate));
        applied.push("tax rate");
      }
      const nextPricesIncludeTax = fieldBoolean(fields, "pricesIncludeTax");
      if (nextPricesIncludeTax !== undefined) {
        setPricesIncludeTax(nextPricesIncludeTax);
        applied.push("tax treatment");
      }
      const nextNotes = fieldString(fields, "notes");
      if (nextNotes !== undefined) {
        setNotes(nextNotes);
        applied.push("notes");
      }
      const nextTerms = fieldString(fields, "termsConditions");
      if (nextTerms !== undefined) {
        setTermsConditions(nextTerms);
        applied.push("terms");
      }
      const nextItems = fields.lineItems;
      if (Array.isArray(nextItems) && nextItems.length > 0) {
        setItems(
          nextItems.map((item) => {
            const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
            const description = typeof row.description === "string" ? row.description : "";
            const quantity = typeof row.quantity === "number" ? row.quantity : 1;
            const unitPriceCents =
              typeof row.unitPriceCents === "number" ? row.unitPriceCents : undefined;
            if (!description) unresolved.push("line-item description");
            if (unitPriceCents === undefined) unresolved.push("line-item amount");
            return {
              key: crypto.randomUUID(),
              description,
              quantity: String(quantity),
              unitPriceDollars:
                unitPriceCents === undefined ? "" : (unitPriceCents / 100).toFixed(2),
            };
          }),
        );
        applied.push("line items");
      }
      return { appliedFields: applied, unresolvedFields: unresolved };
    },
  );

  // Live totals preview from the current line items + tax rate.
  const totals = computeLineItemTotals(
    toLineItemInput(items).map((it) => ({
      quantity: it.quantity,
      unitPriceCents: it.unitPriceCents,
    })),
    Number(taxRate) || 0,
    { pricesIncludeTax },
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

  function updateSection(key: string, patch: Partial<SectionState>) {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }
  function addSection() {
    setSections((prev) => [
      ...prev,
      { key: crypto.randomUUID(), title: "", body: "", optional: false },
    ]);
  }
  function removeSection(key: string) {
    setSections((prev) => prev.filter((s) => s.key !== key));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPending) return;
    setError("");
    setFieldErrors(undefined);

    const lineItemInputs = toLineItemInput(items);
    if (!customerId) {
      setError("Pick a customer - a name and email are required to send the quote.");
      return;
    }
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

    const sectionInputs = sections.map((s) => ({
      title: s.title.trim(),
      body: s.body,
      optional: s.optional,
    }));
    if (sectionInputs.some((s) => s.title === "")) {
      setError("Every section needs a title.");
      return;
    }

    const input = {
      customerId,
      issueDate: new Date(issueDate),
      validUntil: validUntil ? new Date(validUntil) : null,
      currency: quote?.currency ?? defaultCurrency,
      taxRate: Number(taxRate) || 0,
      pricesIncludeTax,
      notes: notes || null,
      termsConditions: termsConditions || null,
      lineItems: lineItemInputs,
      sections: sectionInputs,
    };

    startTransition(async () => {
      let res: Result;
      try {
        res =
          isEdit && quote
            ? await updateQuoteAction({ quoteId: quote.id, ...input })
            : await createQuoteAction(input);
      } catch {
        setError(QUOTE_SAVE_UNCONFIRMED);
        return;
      }
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
    <form onSubmit={onSubmit} aria-busy={isPending}>
      <fieldset disabled={isPending} className="min-w-0 space-y-6 border-0 p-0">
        <HaiPrefillNotice notice={haiNotice} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="customerId">Customer</Label>
            <div className="flex gap-2">
              <select
                id="customerId"
                name="customerId"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Pick a customer…</option>
                {customerList.map((c) => (
                  <option key={c.id} value={c.id} disabled={!c.email}>
                    {c.name}
                    {c.company ? ` · ${c.company}` : ""}
                    {!c.email ? " (no email - add one)" : ""}
                  </option>
                ))}
              </select>
              <CustomerCreateDialog
                onCreated={(c) => {
                  setCustomerList((prev) =>
                    prev.some((p) => p.id === c.id) ? prev : [...prev, c],
                  );
                  setCustomerId(c.id);
                }}
              />
            </div>
            {fieldErr("customerId") ? (
              <p className="text-sm text-destructive">{fieldErr("customerId")}</p>
            ) : null}
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
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={pricesIncludeTax}
                onChange={(e) => setPricesIncludeTax(e.target.checked)}
                className="size-4 rounded border-input"
              />
              Prices include tax (gross)
            </label>
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
              Optional - sent quotes auto-expire past this date.
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
                  placeholder={`Unit ${quote?.currency ?? defaultCurrency}`}
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

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Sections</h2>
            <Button type="button" variant="outline" size="sm" onClick={addSection}>
              <Plus className="size-4" aria-hidden />
              Add section
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Optional content blocks shown to the customer between the line items and totals (e.g.
            scope of work, terms). Mark a section optional if the customer can opt in at accept
            time.
          </p>
          {fieldErr("sections") ? (
            <p className="text-sm text-destructive" role="alert">
              {fieldErr("sections")}
            </p>
          ) : null}
          <div className="space-y-2">
            {sections.map((s, i) => (
              <div key={s.key} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`Section ${i + 1} title`}
                    placeholder="Section title"
                    value={s.title}
                    onChange={(e) => updateSection(s.key, { title: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove section ${i + 1}`}
                    onClick={() => removeSection(s.key)}
                  >
                    <Trash2 className="size-4 text-destructive" aria-hidden />
                  </Button>
                </div>
                <textarea
                  aria-label={`Section ${i + 1} body`}
                  rows={4}
                  maxLength={10000}
                  placeholder="Section body (shown to the customer as written)."
                  value={s.body}
                  onChange={(e) => updateSection(s.key, { body: e.target.value })}
                  className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={s.optional}
                    onChange={(e) => updateSection(s.key, { optional: e.target.checked })}
                    className="size-4 rounded border-input"
                  />
                  Optional (customer can opt in at accept time)
                </label>
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

        <div className="space-y-1.5">
          <Label htmlFor="termsConditions">Terms &amp; Conditions</Label>
          <textarea
            id="termsConditions"
            name="termsConditions"
            rows={5}
            maxLength={50000}
            value={termsConditions}
            onChange={(e) => setTermsConditions(e.target.value)}
            placeholder="Terms shown to the customer above the accept button. Leave blank for none."
            className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="rounded-md border border-border bg-muted/30 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {pricesIncludeTax ? "Subtotal (ex-tax)" : "Subtotal"}
            </span>
            <span className="tabular-nums">
              {formatCents(totals.subtotalCents, quote?.currency ?? defaultCurrency)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Tax ({Number(taxRate) || 0}%{pricesIncludeTax ? ", included" : ""})
            </span>
            <span className="tabular-nums">
              {formatCents(totals.taxCents, quote?.currency ?? defaultCurrency)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-base font-medium">
            <span>Total</span>
            <span className="tabular-nums">
              {formatCents(totals.totalCents, quote?.currency ?? defaultCurrency)}
            </span>
          </div>
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error === QUOTE_SAVE_UNCONFIRMED ? (
              <>
                {QUOTE_SAVE_UNCONFIRMED}{" "}
                <Link
                  href="/quotes"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline underline-offset-4"
                >
                  Check quotes
                  <span className="sr-only"> (opens in a new tab)</span>
                </Link>{" "}
                before trying again.
              </>
            ) : (
              error
            )}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : isEdit ? "Save changes" : "Create quote"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => router.push("/quotes")}
          >
            Cancel
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
