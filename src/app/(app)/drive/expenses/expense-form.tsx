"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  createExpenseAction,
  updateExpenseAction,
  type CreateExpenseResult,
  type UpdateExpenseResult,
} from "./actions";
import { ExpenseReceiptUpload } from "./expense-receipt-upload";
import type { ExpenseRow, VehicleRow } from "@/modules/drive";
import type { VehicleExpenseType } from "@/server/db/enums";
import type { FileId } from "@/shared/types/ids";

type Result = CreateExpenseResult | UpdateExpenseResult;

const EXPENSE_TYPES: { key: VehicleExpenseType; label: string }[] = [
  { key: "fuel", label: "Fuel" },
  { key: "maintenance", label: "Maintenance" },
  { key: "insurance", label: "Insurance" },
  { key: "registration", label: "Registration" },
  { key: "other", label: "Other" },
];

function dollarsToCents(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function isoDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

export function ExpenseForm({
  mode,
  expense,
  vehicles,
  defaultVehicleId,
}: {
  mode: "create" | "edit";
  expense?: ExpenseRow;
  vehicles: VehicleRow[];
  defaultVehicleId?: string | null;
}) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();

  const activeVehicles = vehicles.filter((v) => v.active);
  const selectableVehicles = activeVehicles.length > 0 ? activeVehicles : vehicles;

  const [vehicleId, setVehicleId] = useState<string>(
    expense?.vehicleId ?? defaultVehicleId ?? selectableVehicles[0]?.id ?? "",
  );
  const [type, setType] = useState<VehicleExpenseType>(expense?.type ?? "fuel");
  const [amountDollars, setAmountDollars] = useState<string>(
    expense ? (expense.amountCents / 100).toFixed(2) : "",
  );
  const [date, setDate] = useState<string>(isoDate(expense?.date) || isoDate(new Date()));
  const [description, setDescription] = useState<string>(expense?.description ?? "");
  const [odometerKm, setOdometerKm] = useState<string>(
    expense?.odometerKm != null ? String(expense.odometerKm) : "",
  );
  const [notes, setNotes] = useState<string>(expense?.notes ?? "");
  const [receiptFileId, setReceiptFileId] = useState<FileId | null>(expense?.receiptFileId ?? null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setFieldErrors(undefined);

    const input = {
      vehicleId,
      type,
      amountCents: dollarsToCents(amountDollars),
      currency: "AUD" as string,
      date: new Date(date),
      description: description.trim(),
      odometerKm: odometerKm ? Number(odometerKm) : null,
      notes: notes || null,
      receiptFileId,
    };

    startTransition(async () => {
      const res: Result =
        isEdit && expense
          ? await updateExpenseAction({ expenseId: expense.id, ...input })
          : await createExpenseAction(input);
      if (res.ok) {
        router.push("/drive/expenses");
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
          <Label htmlFor="vehicleId">Vehicle</Label>
          <select
            id="vehicleId"
            name="vehicleId"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            aria-invalid={Boolean(fieldErr("vehicleId"))}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {selectableVehicles.length === 0 ? (
              <option value="">No vehicles — add one first</option>
            ) : (
              selectableVehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))
            )}
          </select>
          {fieldErr("vehicleId") ? (
            <p className="text-sm text-destructive">{fieldErr("vehicleId")}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="type">Type</Label>
          <select
            id="type"
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as VehicleExpenseType)}
            aria-invalid={Boolean(fieldErr("type"))}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {EXPENSE_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          {fieldErr("type") ? <p className="text-sm text-destructive">{fieldErr("type")}</p> : null}
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
          <Label htmlFor="odometerKm">Odometer (km)</Label>
          <Input
            id="odometerKm"
            name="odometerKm"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={odometerKm}
            onChange={(e) => setOdometerKm(e.target.value)}
            aria-invalid={Boolean(fieldErr("odometerKm"))}
            className="tabular-nums"
          />
          {fieldErr("odometerKm") ? (
            <p className="text-sm text-destructive">{fieldErr("odometerKm")}</p>
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
          placeholder="What was this expense for?"
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

      <ExpenseReceiptUpload
        initialFileId={expense?.receiptFileId ?? null}
        initialFileName={expense?.receiptFileId ? "Receipt" : null}
        onChange={setReceiptFileId}
      />

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : isEdit ? "Save changes" : "Log expense"}
        </Button>
        <Button asChild type="button" variant="outline">
          <Link href="/drive/expenses">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
