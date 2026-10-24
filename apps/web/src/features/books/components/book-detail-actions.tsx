"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteTransactionAction } from "@/features/books/api/actions";

type Action = { kind: "delete" };

const DIALOG_COPY: Record<Action["kind"], { title: string; description: string; cta: string }> = {
  delete: {
    title: "Delete transaction?",
    description:
      "Permanently deletes this transaction. The audit log keeps a record. This cannot be undone.",
    cta: "Delete",
  },
};

export function BookDetailActions({ txId }: { txId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string>("");

  function run() {
    setError("");
    startTransition(async () => {
      const res = await deleteTransactionAction({ transactionId: txId });
      if (!res.ok) {
        setError(res.error ?? "Action failed.");
        return;
      }
      router.push("/books");
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href={`/books/${txId}/edit`}>
            <Pencil className="size-4" aria-hidden />
            Edit
          </Link>
        </Button>
        <Button
          variant="ghost"
          onClick={() => setPending({ kind: "delete" })}
          disabled={isPending}
          className="text-destructive"
        >
          <Trash2 className="size-4" aria-hidden />
          Delete
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending ? DIALOG_COPY[pending.kind].title : ""}</DialogTitle>
            <DialogDescription>
              {pending ? DIALOG_COPY[pending.kind].description : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pending) run();
              }}
              disabled={isPending}
            >
              {isPending ? "Working…" : pending ? DIALOG_COPY[pending.kind].cta : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
