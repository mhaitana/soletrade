"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  createVehicleAction,
  updateVehicleAction,
  type CreateVehicleResult,
  type UpdateVehicleResult,
} from "./actions";
import type { VehicleRow } from "@/modules/drive";
import {
  HaiPrefillNotice,
  fieldBoolean,
  fieldNumber,
  fieldString,
  useHaiFormPrefill,
} from "@/app/(app)/assistant/hai-form-prefill";

type Result = CreateVehicleResult | UpdateVehicleResult;

export function VehicleForm({ mode, vehicle }: { mode: "create" | "edit"; vehicle?: VehicleRow }) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();

  const [name, setName] = useState<string>(vehicle?.name ?? "");
  const [make, setMake] = useState<string>(vehicle?.make ?? "");
  const [model, setModel] = useState<string>(vehicle?.model ?? "");
  const [year, setYear] = useState<string>(vehicle?.year ? String(vehicle.year) : "");
  const [odometerKm, setOdometerKm] = useState<string>(
    vehicle?.odometerKm != null ? String(vehicle.odometerKm) : "",
  );
  const [active, setActive] = useState<boolean>(vehicle?.active ?? true);

  const haiNotice = useHaiFormPrefill(
    mode === "create" ? "drive.vehicle.create" : "drive.vehicle.edit",
    (fields) => {
      const applied: string[] = [];
      const nextName = fieldString(fields, "name");
      if (nextName) {
        setName(nextName);
        applied.push("vehicle name");
      }
      const nextMake = fieldString(fields, "make");
      if (nextMake !== undefined) {
        setMake(nextMake);
        applied.push("make");
      }
      const nextModel = fieldString(fields, "model");
      if (nextModel !== undefined) {
        setModel(nextModel);
        applied.push("model");
      }
      const nextYear = fieldNumber(fields, "year");
      if (nextYear !== undefined) {
        setYear(String(nextYear));
        applied.push("year");
      }
      const nextOdometer = fieldNumber(fields, "odometerKm");
      if (nextOdometer !== undefined) {
        setOdometerKm(String(nextOdometer));
        applied.push("odometer");
      }
      const nextActive = fieldBoolean(fields, "active");
      if (nextActive !== undefined) {
        setActive(nextActive);
        applied.push("active status");
      }
      return { appliedFields: applied };
    },
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setFieldErrors(undefined);

    const input = {
      name: name.trim(),
      make: make.trim() || null,
      model: model.trim() || null,
      year: year ? Number(year) : null,
      odometerKm: odometerKm ? Number(odometerKm) : null,
      active,
    };

    startTransition(async () => {
      const res: Result =
        isEdit && vehicle
          ? await updateVehicleAction({ vehicleId: vehicle.id, ...input })
          : await createVehicleAction(input);
      if (res.ok) {
        router.push("/drive/vehicles");
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
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(fieldErr("name"))}
            placeholder="e.g. My Honda Civic"
          />
          {fieldErr("name") ? <p className="text-sm text-destructive">{fieldErr("name")}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="make">Make</Label>
          <Input
            id="make"
            name="make"
            maxLength={80}
            value={make}
            onChange={(e) => setMake(e.target.value)}
            aria-invalid={Boolean(fieldErr("make"))}
            placeholder="e.g. Honda"
          />
          {fieldErr("make") ? <p className="text-sm text-destructive">{fieldErr("make")}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="model">Model</Label>
          <Input
            id="model"
            name="model"
            maxLength={80}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            aria-invalid={Boolean(fieldErr("model"))}
            placeholder="e.g. Civic"
          />
          {fieldErr("model") ? (
            <p className="text-sm text-destructive">{fieldErr("model")}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="year">Year</Label>
          <Input
            id="year"
            name="year"
            type="number"
            min={1900}
            step={1}
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            aria-invalid={Boolean(fieldErr("year"))}
            className="tabular-nums"
          />
          {fieldErr("year") ? <p className="text-sm text-destructive">{fieldErr("year")}</p> : null}
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
        <div className="space-y-1.5">
          <Label htmlFor="active">Active</Label>
          <select
            id="active"
            name="active"
            value={active ? "true" : "false"}
            onChange={(e) => setActive(e.target.value === "true")}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : isEdit ? "Save changes" : "Add vehicle"}
        </Button>
        <Button asChild type="button" variant="outline">
          <Link href="/drive/vehicles">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
