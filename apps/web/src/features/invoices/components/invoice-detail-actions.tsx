"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, Send, Trash2, XCircle } from "lucide-react";
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
  deleteInvoiceAction,
  markInvoicePaidAction,
  sendInvoiceAction,
  voidInvoiceAction,
} from "@/features/invoices/api/actions";
import type { InvoiceStatus } from "@/lib/domain/database-enums";

type Action = { kind: "send" } | { kind: "markPaid" } | { kind: "void" } | { kind: "delete" };

const SUCCESS_TOAST: Record<Action["kind"], string> = {
  send: "Invoice sent.",
  markPaid: "Invoice marked paid.",
  void: "Invoice voided.",
  delete: "Draft deleted.",
};

const DIALOG_COPY: Record<Action["kind"], { title: string; description: string; cta: string }> = {
  send: {
    title: "Send invoice?",
    description:
      "This locks the invoice, creates a public payment link, and emails the customer a payable link.",
    cta: "Send",
  },
  markPaid: {
    title: "Mark invoice paid?",
    description:
      "Records a payment you received outside the app, such as a bank transfer or cash. A customer with an email address on file is sent a payment confirmation.",
    cta: "Mark paid",
  },
  void: {
    title: "Void invoice?",
    description: "Voids the invoice. The record is kept for history; it can no longer be paid.",
    cta: "Void",
  },
  delete: {
    title: "Delete draft?",
    description: "Permanently deletes this draft invoice. This cannot be undone.",
    cta: "Delete",
  },
};

export function InvoiceDetailActions({
  invoiceId,
  status,
}: {
  invoiceId: string;
  status: InvoiceStatus;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string>("");

  const isDraft = status === "draft";
  const isSent = status === "sent" || status === "viewed" || status === "overdue";

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
      const input = { invoiceId };
      let res: { ok: boolean; error?: string };
      if (kind === "send") res = await sendInvoiceAction(input);
      else if (kind === "markPaid") res = await markInvoicePaidAction(input);
      else if (kind === "void") res = await voidInvoiceAction(input);
      else res = await deleteInvoiceAction(input);
      if (!res.ok) {
        setError(res.error ?? "Action failed.");
        return;
      }
      closeDialog();
      toast.success(SUCCESS_TOAST[kind]);
      if (kind === "delete") router.push("/invoices");
      router.refresh();
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
              <Link href={`/invoices/${invoiceId}/edit`}>
                <Pencil className="size-4" aria-hidden />
                Edit
              </Link>
            </Button>
            <Button variant="outline" onClick={() => openDialog("void")} disabled={isPending}>
              <XCircle className="size-4" aria-hidden />
              Void
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
        {isSent ? (
          <>
            <Button onClick={() => openDialog("markPaid")} disabled={isPending}>
              <Check className="size-4" aria-hidden />
              Mark paid
            </Button>
            <Button variant="outline" onClick={() => openDialog("void")} disabled={isPending}>
              <XCircle className="size-4" aria-hidden />
              Void
            </Button>
          </>
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
              variant={
                pending?.kind === "delete" || pending?.kind === "void" ? "destructive" : "default"
              }
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
