"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { deleteVehicleAction } from "./actions";

/**
 * Delete dialog for a vehicle (mirrors `drive-detail-actions.tsx`). Deleting a vehicle
 * cascade-deletes its expenses (FK on delete cascade). The audit log keeps a record.
 */
export function VehicleDeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>("");

  function run() {
    setError("");
    startTransition(async () => {
      const res = await deleteVehicleAction({ vehicleId: id });
      if (!res.ok) {
        setError(res.error ?? "Action failed.");
        return;
      }
      router.push("/drive/vehicles");
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => setOpen(true)}
        disabled={isPending}
        className="text-destructive"
      >
        <Trash2 className="size-4" aria-hidden />
        Delete
      </Button>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete vehicle?</DialogTitle>
            <DialogDescription>
              Permanently deletes this vehicle and all of its logged expenses. The audit log keeps a
              record. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={run} disabled={isPending}>
              {isPending ? "Working…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
