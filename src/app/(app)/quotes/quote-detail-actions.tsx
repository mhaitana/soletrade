"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Pencil, Send, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { convertQuoteToInvoiceAction, deleteQuoteAction, sendQuoteAction } from "./actions";
import type { QuoteStatus } from "@/server/db/schema/enums";

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
        router.refresh();
      } else if (kind === "delete") {
        const res = await deleteQuoteAction(input);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.push("/quotes");
      } else if (kind === "convert") {
        const res = await convertQuoteToInvoiceAction(input);
        if (!res.ok) {
          setError(res.error);
          return;
        }
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
            <Button onClick={() => setPending({ kind: "send" })} disabled={isPending}>
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
              onClick={() => setPending({ kind: "delete" })}
              disabled={isPending}
              className="text-destructive"
            >
              <Trash2 className="size-4" aria-hidden />
              Delete
            </Button>
          </>
        ) : null}
        {isAccepted ? (
          <Button onClick={() => setPending({ kind: "convert" })} disabled={isPending}>
            <FileText className="size-4" aria-hidden />
            Convert to invoice
          </Button>
        ) : null}
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
