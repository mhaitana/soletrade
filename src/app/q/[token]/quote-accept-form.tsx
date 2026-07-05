"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { acceptQuoteAction, declineQuoteAction } from "./actions";

type Pending = "accept" | "decline" | null;

export function QuoteAcceptForm({ token }: { token: string }) {
  const [isPending, startTransition] = useTransition();
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string>("");
  const [done, setDone] = useState<"accepted" | "declined" | null>(null);

  function run(kind: "accept" | "decline") {
    setPending(null);
    setError("");
    startTransition(async () => {
      const res =
        kind === "accept"
          ? await acceptQuoteAction({ token })
          : await declineQuoteAction({ token });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(kind === "accept" ? "accepted" : "declined");
    });
  }

  if (done === "accepted") {
    return (
      <div
        className="mt-6 flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4"
        role="status"
        aria-live="polite"
      >
        <Check className="size-5 text-emerald-600" aria-hidden />
        <div className="text-sm">
          <p className="font-medium text-emerald-800">Quote accepted</p>
          <p className="text-emerald-700">
            Thank you — the business will be in touch with an invoice.
          </p>
        </div>
      </div>
    );
  }

  if (done === "declined") {
    return (
      <div className="mt-6 flex items-center gap-3 rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        <X className="size-5" aria-hidden />
        <span>This quote has been declined.</span>
      </div>
    );
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={() => setPending("accept")} disabled={isPending}>
          <Check className="size-4" aria-hidden />
          Accept quote
        </Button>
        <Button variant="outline" onClick={() => setPending("decline")} disabled={isPending}>
          <X className="size-4" aria-hidden />
          Decline
        </Button>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending === "accept" ? "Accept this quote?" : "Decline this quote?"}
            </DialogTitle>
            <DialogDescription>
              {pending === "accept"
                ? "Confirming you accept the terms and total shown. The business will be notified and can convert this quote to an invoice."
                : "Confirming you decline this quote. The business will be notified."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant={pending === "decline" ? "destructive" : "default"}
              onClick={() => pending && run(pending)}
              disabled={isPending}
            >
              {isPending ? "Working…" : pending === "accept" ? "Confirm accept" : "Confirm decline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
