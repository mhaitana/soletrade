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
import { deleteEarningAction, deleteTripAction } from "./actions";

/**
 * Delete dialog for a Drive earning or trip (mirrors `book-detail-actions.tsx`). The list
 * row's edit page renders this alongside the form's "Save changes" so a user can delete from
 * the edit page. Drive has no read-only detail page (deferred) - the edit page shows all
 * fields.
 */
export function DriveDeleteButton({ kind, id }: { kind: "earning" | "trip"; id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>("");

  const copy =
    kind === "earning"
      ? {
          title: "Delete earning?",
          description:
            "Permanently deletes this earning. The audit log keeps a record. This cannot be undone.",
          cta: "Delete",
        }
      : {
          title: "Delete trip?",
          description:
            "Permanently deletes this mileage trip. The audit log keeps a record. This cannot be undone.",
          cta: "Delete",
        };

  function run() {
    setError("");
    startTransition(async () => {
      const res =
        kind === "earning"
          ? await deleteEarningAction({ earningId: id })
          : await deleteTripAction({ tripId: id });
      if (!res.ok) {
        setError(res.error ?? "Action failed.");
        return;
      }
      router.push("/drive");
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
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={run} disabled={isPending}>
              {isPending ? "Working…" : copy.cta}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
