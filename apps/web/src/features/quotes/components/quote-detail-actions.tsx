"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Pencil, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  convertQuoteToInvoiceAction,
  deleteQuoteAction,
  sendQuoteAction,
} from "@/features/quotes/api/actions";
import type { QuoteStatus } from "@/lib/domain/database-enums";

type Action = { kind: "send" } | { kind: "delete" } | { kind: "convert" };

const DIALOG_COPY: Record<Action["kind"], { title: string; description: string; cta: string }> = {
  send: {
    title: "Send quote?",
    description:
      "This locks the quote and emails the customer a shareable public link to accept or decline.",
    cta: "Send",
  },
  delete: {
    title: "Delete draft?",
    description: "Permanently deletes this draft quote. This cannot be undone.",
    cta: "Delete",
  },
  convert: {
    title: "Convert to invoice?",
    description:
      "Creates a draft invoice from this quote's customer, line items, and totals. You can review and edit the invoice before sending it.",
    cta: "Convert to invoice",
  },
};

export function QuoteDetailActions({ quoteId, status }: { quoteId: string; status: QuoteStatus }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string>("");

  const isDraft = status === "draft";
  const isAccepted = status === "accepted";

  function openDialog(kind: Action["kind"]) {
    setError("");
    setPending({ kind });
  }

  function closeDialog() {
    setError("");
    setPending(null);
  }

  async function run(kind: Action["kind"]) {
    setError("");
    startTransition(async () => {
      const input = { quoteId };
      if (kind === "send") {
        const res = await sendQuoteAction(input);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        // Close on success: the page behind refreshes to the sent state, and leaving the
        // confirmation open invited a second send.
        closeDialog();
        toast.success("Quote sent.");
        router.refresh();
      } else if (kind === "delete") {
        const res = await deleteQuoteAction(input);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        closeDialog();
        toast.success("Draft deleted.");
        router.push("/quotes");
      } else if (kind === "convert") {
        const res = await convertQuoteToInvoiceAction(input);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        closeDialog();
        toast.success("Draft invoice created from this quote.");
        router.push(`/invoices/${res.invoiceId}`);
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {isDraft ? (
          <>
            <Button onClick={() => openDialog("send")} disabled={isPending}>
              <Send className="size-4" aria-hidden />
              Send
            </Button>
            <Button asChild variant="outline">
              <Link href={`/quotes/${quoteId}/edit`}>
                <Pencil className="size-4" aria-hidden />
                Edit
              </Link>
            </Button>
            <Button
              variant="ghost"
              onClick={() => openDialog("delete")}
              disabled={isPending}
              className="text-destructive"
            >
              <Trash2 className="size-4" aria-hidden />
              Delete
            </Button>
          </>
        ) : null}
        {isAccepted ? (
          <Button onClick={() => openDialog("convert")} disabled={isPending}>
            <FileText className="size-4" aria-hidden />
            Convert to invoice
          </Button>
        ) : null}
      </div>

      {/* The error lives inside the dialog: while it is open the page behind is inert and
          hidden from assistive technology, so a message rendered there would go unseen. */}
      <Dialog
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o && !isPending) closeDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending ? DIALOG_COPY[pending.kind].title : ""}</DialogTitle>
            <DialogDescription>
              {pending ? DIALOG_COPY[pending.kind].description : ""}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant={pending?.kind === "delete" ? "destructive" : "default"}
              onClick={() => pending && run(pending.kind)}
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
