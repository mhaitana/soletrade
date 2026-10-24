"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DRIVE_PLATFORMS } from "@/config/drive-platforms";
import {
  createEarningAction,
  updateEarningAction,
  type CreateEarningResult,
  type UpdateEarningResult,
} from "@/features/drive/api/actions";
import type { EarningRow } from "@/lib/domain/drive/types";
import {
  HaiPrefillNotice,
  fieldNumber,
  fieldString,
  useHaiFormPrefill,
} from "@/components/assisted-form/hai-form-prefill";

type Result = CreateEarningResult | UpdateEarningResult;

function dollarsToCents(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function isoDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

export function DriveEarningForm({
  mode,
  earning,
  defaultCurrency,
}: {
  mode: "create" | "edit";
  earning?: EarningRow;
  defaultCurrency: string;
}) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();

  const [platform, setPlatform] = useState<string>(earning?.platform ?? DRIVE_PLATFORMS[0]!.key);
  const [amountDollars, setAmountDollars] = useState<string>(
    earning ? (earning.amountCents / 100).toFixed(2) : "",
  );
  const [date, setDate] = useState<string>(isoDate(earning?.date) || isoDate(new Date()));
  const [description, setDescription] = useState<string>(earning?.description ?? "");
  const [notes, setNotes] = useState<string>(earning?.notes ?? "");

  const haiNotice = useHaiFormPrefill(
    mode === "create" ? "drive.earning.create" : "drive.earning.edit",
    (fields) => {
      const applied: string[] = [];
      const unresolved: string[] = [];
      const nextPlatform = fieldString(fields, "platform");
      if (nextPlatform) {
        if (DRIVE_PLATFORMS.some((entry) => entry.key === nextPlatform)) {
          setPlatform(nextPlatform);
          applied.push("platform");
        } else {
          unresolved.push(`platform “${nextPlatform}” (select a match)`);
        }
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
      const nextNotes = fieldString(fields, "notes");
      if (nextNotes !== undefined) {
        setNotes(nextNotes);
        applied.push("notes");
      }
      return { appliedFields: applied, unresolvedFields: unresolved };
    },
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setFieldErrors(undefined);

    const input = {
      platform,
      amountCents: dollarsToCents(amountDollars),
      currency: earning?.currency ?? defaultCurrency,
      date: new Date(date),
      description: description.trim(),
      notes: notes || null,
    };

    startTransition(async () => {
      const res: Result =
        isEdit && earning
          ? await updateEarningAction({ earningId: earning.id, ...input })
          : await createEarningAction(input);
      if (res.ok) {
        router.push("/drive");
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
          <Label htmlFor="platform">Platform</Label>
          <select
            id="platform"
            name="platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            aria-invalid={Boolean(fieldErr("platform"))}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {DRIVE_PLATFORMS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          {fieldErr("platform") ? (
            <p className="text-sm text-destructive">{fieldErr("platform")}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="amountDollars">Amount ({earning?.currency ?? defaultCurrency})</Label>
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
          placeholder="What did you earn this for?"
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
          {isPending ? "Saving…" : isEdit ? "Save changes" : "Log earning"}
        </Button>
        <Button asChild type="button" variant="outline">
          <Link href="/drive">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
