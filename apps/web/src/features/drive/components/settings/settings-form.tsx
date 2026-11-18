"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  upsertDriveSettingsAction,
  type UpsertDriveSettingsResult,
} from "@/features/drive/api/settings/actions";
import type { VehicleRow } from "@/lib/domain/drive/types";
import {
  HaiPrefillNotice,
  fieldNumber,
  fieldString,
  resolvePickerId,
  useHaiFormPrefill,
} from "@/components/assisted-form/hai-form-prefill";

export function DriveSettingsForm({
  mileageRateCentsPerKm,
  defaultVehicleId,
  vehicles,
}: {
  mileageRateCentsPerKm: number;
  defaultVehicleId: string | null;
  vehicles: VehicleRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();

  const [rate, setRate] = useState<string>(String(mileageRateCentsPerKm));
  const [vehicleId, setVehicleId] = useState<string>(defaultVehicleId ?? "");

  const haiNotice = useHaiFormPrefill("drive.settings", (fields) => {
    const applied: string[] = [];
    const unresolved: string[] = [];
    const nextRate = fieldNumber(fields, "mileageRateCentsPerKm");
    if (nextRate !== undefined) {
      setRate(String(nextRate));
      applied.push("mileage rate");
    }
    const vehicleQuery = fieldString(fields, "defaultVehicleQuery");
    if (vehicleQuery) {
      const id = resolvePickerId(vehicleQuery, vehicles);
      if (id) {
        setVehicleId(id);
        applied.push("default vehicle");
      } else {
        unresolved.push(`vehicle “${vehicleQuery}” (select a match)`);
      }
    }
    return { appliedFields: applied, unresolvedFields: unresolved };
  });

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setFieldErrors(undefined);

    const input = {
      mileageRateCentsPerKm: Number(rate),
      defaultVehicleId: vehicleId || null,
    };

    startTransition(async () => {
      const res: UpsertDriveSettingsResult = await upsertDriveSettingsAction(input);
      if (res.ok) {
        toast.success("Drive settings saved");
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
          <Label htmlFor="rate">Mileage rate (cents per km)</Label>
          <Input
            id="rate"
            name="rate"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            required
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            aria-invalid={Boolean(fieldErr("mileageRateCentsPerKm"))}
            className="tabular-nums"
          />
          <p className="text-xs text-muted-foreground">
            The ATO cents-per-km rate used to estimate your mileage deduction. Default: 85 c/km.
          </p>
          {fieldErr("mileageRateCentsPerKm") ? (
            <p className="text-sm text-destructive">{fieldErr("mileageRateCentsPerKm")}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vehicleId">Default vehicle</Label>
          <select
            id="vehicleId"
            name="vehicleId"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            aria-invalid={Boolean(fieldErr("defaultVehicleId"))}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">None</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Pre-selected when logging a new expense or quick trip.
          </p>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}
