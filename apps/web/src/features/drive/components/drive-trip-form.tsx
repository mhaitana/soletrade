"use client";

import { useState, useTransition } from "react";
import { useRequestId } from "@/hooks/use-request-id";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DRIVE_PLATFORMS } from "@/config/drive-platforms";
import {
  createTripAction,
  updateTripAction,
  type CreateTripResult,
  type UpdateTripResult,
} from "@/features/drive/api/actions";
import type { TripRow } from "@/lib/domain/drive/types";
import {
  HaiPrefillNotice,
  fieldNumber,
  fieldString,
  useHaiFormPrefill,
} from "@/components/assisted-form/hai-form-prefill";

type Result = CreateTripResult | UpdateTripResult;

function isoDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

export function DriveTripForm({ mode, trip }: { mode: "create" | "edit"; trip?: TripRow }) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const [isPending, startTransition] = useTransition();
  const { requestId } = useRequestId();
  const [error, setError] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();

  const [platform, setPlatform] = useState<string>(trip?.platform ?? DRIVE_PLATFORMS[0]!.key);
  const [distanceKm, setDistanceKm] = useState<string>(
    trip ? (trip.distanceMeters / 1000).toString() : "",
  );
  const [date, setDate] = useState<string>(isoDate(trip?.date) || isoDate(new Date()));
  const [purpose, setPurpose] = useState<string>(trip?.purpose ?? "");
  const [notes, setNotes] = useState<string>(trip?.notes ?? "");

  const haiNotice = useHaiFormPrefill(
    mode === "create" ? "drive.trip.create" : "drive.trip.edit",
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
      const nextDistance = fieldNumber(fields, "distanceKm");
      if (nextDistance !== undefined) {
        setDistanceKm(String(nextDistance));
        applied.push("distance");
      }
      const nextDate = fieldString(fields, "date");
      if (nextDate) {
        setDate(nextDate);
        applied.push("date");
      }
      const nextPurpose = fieldString(fields, "purpose");
      if (nextPurpose !== undefined) {
        setPurpose(nextPurpose);
        applied.push("purpose");
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
      distanceKm: Number(distanceKm),
      date: new Date(date),
      purpose: purpose.trim() || null,
      notes: notes || null,
    };

    startTransition(async () => {
      const res: Result =
        isEdit && trip
          ? await updateTripAction({ tripId: trip.id, ...input })
          : await createTripAction({ requestId, ...input });
      if (res.ok) {
        toast.success(isEdit ? "Trip updated" : "Trip logged");
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
          <Label htmlFor="distanceKm">Distance (km)</Label>
          <Input
            id="distanceKm"
            name="distanceKm"
            type="number"
            min={0.1}
            step="0.1"
            inputMode="decimal"
            required
            value={distanceKm}
            onChange={(e) => setDistanceKm(e.target.value)}
            aria-invalid={Boolean(fieldErr("distanceKm"))}
            className="tabular-nums"
          />
          {fieldErr("distanceKm") ? (
            <p className="text-sm text-destructive">{fieldErr("distanceKm")}</p>
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
        <Label htmlFor="purpose">Purpose</Label>
        <Input
          id="purpose"
          name="purpose"
          maxLength={280}
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          aria-invalid={Boolean(fieldErr("purpose"))}
          placeholder="Why was this trip driven? (e.g. Airport run)"
        />
        {fieldErr("purpose") ? (
          <p className="text-sm text-destructive">{fieldErr("purpose")}</p>
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
          {isPending ? "Saving…" : isEdit ? "Save changes" : "Log trip"}
        </Button>
        <Button asChild type="button" variant="outline">
          <Link href="/drive">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
