"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DRIVE_PLATFORMS, platformLabel } from "@/config/drive-platforms";
import { createEarningsAction } from "@/features/drive/api/actions";
import { formatCents } from "@/lib/domain/billing/pricing";
import { MAX_EARNINGS_BATCH_SIZE } from "@/lib/domain/drive/constants";

type Draft = {
  id: number;
  date: string;
  platform: string;
  amount: string;
  description: string;
  notes: string;
};
type RowErrors = Record<number, Record<string, string>>;

const selectClassName =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Calendar-only dates use UTC for arithmetic so DST never skips or repeats a day.
function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function addDays(value: string, days: number): string {
  const date = parseDate(value);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monday(value: string): string {
  const date = parseDate(value);
  return date ? addDays(value, -((date.getUTCDay() + 6) % 7)) : "";
}

function newDraft(id: number, date: string, platform: string): Draft {
  return { id, date, platform, amount: "", description: "", notes: "" };
}

function cents(amount: string): number {
  const number = Number(amount);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

export function DriveEarningsForm({
  defaultCurrency,
  initialDate,
}: {
  defaultCurrency: string;
  initialDate: string;
}) {
  const router = useRouter();
  const formId = useId();
  const nextId = useRef(1);
  const [isPending, startTransition] = useTransition();
  const [platform, setPlatform] = useState<string>(DRIVE_PLATFORMS[0].key);
  const [rows, setRows] = useState<Draft[]>(() => [
    newDraft(0, initialDate, DRIVE_PLATFORMS[0].key),
  ]);
  const [weekStart, setWeekStart] = useState(() => monday(initialDate));
  const [error, setError] = useState("");
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [rowErrors, setRowErrors] = useState<RowErrors>({});
  const enteredRows = rows.filter((row) => row.amount.trim() !== "");
  const total = enteredRows.reduce((sum, row) => sum + Math.max(0, cents(row.amount)), 0);

  function updateRow(id: number, field: keyof Omit<Draft, "id">, value: string) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setRowErrors((current) => ({ ...current, [id]: {} }));
  }

  function addWeek() {
    const start = monday(weekStart);
    if (!start) {
      setError("Choose a valid week starting date.");
      return;
    }
    const dates = Array.from({ length: 7 }, (_, index) => addDays(start, index));
    if (dates.some((date) => !parseDate(date))) {
      setError("Choose a week with valid dates.");
      return;
    }
    const missing = dates.filter(
      (date) => !rows.some((row) => row.date === date && row.platform === platform),
    );
    if (rows.length + missing.length > MAX_EARNINGS_BATCH_SIZE) {
      setError(
        `You can add up to ${MAX_EARNINGS_BATCH_SIZE} earnings at a time. Remove unused rows first.`,
      );
      return;
    }
    setError("");
    setWeekStart(start);
    setRows(
      [...rows, ...missing.map((date) => newDraft(nextId.current++, date, platform))].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || enteredRows.length === 0) return;
    setError("");
    setUnconfirmed(false);
    setRowErrors({});
    const submittedRows = enteredRows;

    startTransition(async () => {
      try {
        const result = await createEarningsAction({
          earnings: submittedRows.map((row) => ({
            platform: row.platform,
            amountCents: cents(row.amount),
            currency: defaultCurrency,
            date: new Date(row.date),
            description: row.description.trim() || `${platformLabel(row.platform)} earnings`,
            notes: row.notes.trim() || null,
          })),
        });
        if (result.ok) {
          toast.success(
            enteredRows.length === 1 ? "Earning logged" : `${enteredRows.length} earnings logged`,
          );
          router.push("/drive");
          router.refresh();
          return;
        }
        setError(result.error);
        setUnconfirmed(Boolean(result.unconfirmed));
        const errors: RowErrors = {};
        for (const [path, messages] of Object.entries(result.fieldErrors ?? {})) {
          const [, index, field] = path.split(".");
          const row = submittedRows[Number(index)];
          if (row && field && messages[0]) {
            errors[row.id] = { ...errors[row.id], [field]: messages[0] };
          }
        }
        setRowErrors(errors);
      } catch {
        setError(
          "We couldn’t confirm whether these earnings were saved. Check your earnings before trying again to avoid duplicates.",
        );
        setUnconfirmed(true);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} aria-busy={isPending}>
      <fieldset disabled={isPending} className="min-w-0 space-y-6 border-0 p-0">
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-40 flex-1 space-y-1.5">
              <Label htmlFor={`${formId}-platform`}>Platform for new rows</Label>
              <select
                id={`${formId}-platform`}
                value={platform}
                onChange={(event) => setPlatform(event.target.value)}
                className={selectClassName}
              >
                {DRIVE_PLATFORMS.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-40 flex-1 space-y-1.5">
              <Label htmlFor={`${formId}-week`}>Week starting</Label>
              <Input
                id={`${formId}-week`}
                type="date"
                max="9999-12-31"
                value={weekStart}
                onChange={(event) => setWeekStart(event.target.value)}
              />
            </div>
            <Button type="button" variant="outline" onClick={addWeek}>
              <Plus className="size-4" aria-hidden /> Add a week
            </Button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Add Monday–Sunday for the selected week. Enter an amount for each day worked; leave days
            off blank.
          </p>
        </div>

        <div className="space-y-3">
          {rows.map((row, index) => {
            const errors = rowErrors[row.id] ?? {};
            const prefix = `${formId}-${row.id}`;
            const date = parseDate(row.date);
            const weekday = date?.toLocaleDateString("en-AU", { weekday: "long", timeZone: "UTC" });
            function errorProps(field: string) {
              return {
                "aria-invalid": Boolean(errors[field]),
                "aria-describedby": errors[field] ? `${prefix}-${field}-error` : undefined,
              };
            }
            function fieldError(field: string) {
              return errors[field] ? (
                <p id={`${prefix}-${field}-error`} className="text-sm text-destructive">
                  {errors[field]}
                </p>
              ) : null;
            }
            return (
              <fieldset key={row.id} className="min-w-0 rounded-lg border p-4">
                <legend className="px-1 text-sm font-medium">
                  Earning {index + 1}
                  {weekday ? ` · ${weekday}` : ""}
                </legend>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor={`${prefix}-date`}>Date</Label>
                    <Input
                      id={`${prefix}-date`}
                      type="date"
                      max="9999-12-31"
                      required={row.amount !== ""}
                      value={row.date}
                      onChange={(event) => updateRow(row.id, "date", event.target.value)}
                      {...errorProps("date")}
                    />
                    {fieldError("date")}
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor={`${prefix}-platform`}>Platform</Label>
                    <select
                      id={`${prefix}-platform`}
                      value={row.platform}
                      onChange={(event) => updateRow(row.id, "platform", event.target.value)}
                      className={selectClassName}
                      {...errorProps("platform")}
                    >
                      {DRIVE_PLATFORMS.map((entry) => (
                        <option key={entry.key} value={entry.key}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                    {fieldError("platform")}
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor={`${prefix}-amount`}>Amount ({defaultCurrency})</Label>
                    <Input
                      id={`${prefix}-amount`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      value={row.amount}
                      onChange={(event) => updateRow(row.id, "amount", event.target.value)}
                      className="tabular-nums"
                      {...errorProps("amountCents")}
                    />
                    {fieldError("amountCents")}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="self-start sm:self-end"
                    aria-label={`Remove earning ${index + 1}`}
                    disabled={rows.length === 1}
                    onClick={() => setRows(rows.filter((entry) => entry.id !== row.id))}
                  >
                    <Trash2 className="size-4" aria-hidden />{" "}
                    <span className="lg:sr-only">Remove</span>
                  </Button>
                </div>
                <div className="mt-3 space-y-1.5">
                  <Label htmlFor={`${prefix}-description`}>Description (optional)</Label>
                  <Input
                    id={`${prefix}-description`}
                    maxLength={280}
                    value={row.description}
                    placeholder={`${platformLabel(row.platform)} earnings`}
                    onChange={(event) => updateRow(row.id, "description", event.target.value)}
                    {...errorProps("description")}
                  />
                  {fieldError("description")}
                </div>
                <details className="mt-3" open={errors.notes ? true : undefined}>
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    Notes (optional)
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    <Label htmlFor={`${prefix}-notes`} className="sr-only">
                      Notes
                    </Label>
                    <Input
                      id={`${prefix}-notes`}
                      maxLength={2000}
                      value={row.notes}
                      onChange={(event) => updateRow(row.id, "notes", event.target.value)}
                      {...errorProps("notes")}
                    />
                    {fieldError("notes")}
                  </div>
                </details>
              </fieldset>
            );
          })}
        </div>

        <Button
          type="button"
          variant="outline"
          disabled={rows.length >= MAX_EARNINGS_BATCH_SIZE}
          onClick={() =>
            setRows([
              ...rows,
              newDraft(nextId.current++, addDays(rows.at(-1)!.date, 1) || today(), platform),
            ])
          }
        >
          <Plus className="size-4" aria-hidden /> Add earning
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p role="status" className="text-sm font-medium tabular-nums">
            {enteredRows.length} {enteredRows.length === 1 ? "earning" : "earnings"} ·{" "}
            {formatCents(total, defaultCurrency)} total
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={isPending || enteredRows.length === 0}>
              {isPending
                ? "Saving…"
                : `Log ${enteredRows.length} ${enteredRows.length === 1 ? "earning" : "earnings"}`}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push("/drive")}>
              Cancel
            </Button>
          </div>
        </div>
      </fieldset>
      {error ? (
        <div role="alert" className="mt-4 space-y-2 text-sm text-destructive">
          <p>{error}</p>
          {unconfirmed ? (
            <a href="/drive" target="_blank" rel="noopener noreferrer" className="underline">
              Check earnings (opens in a new tab)
            </a>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
