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
import { deleteCustomerAction } from "@/features/customers/api/actions";
import type { CustomerRow } from "@/lib/domain/customers/types";

export function CustomersTable({
  customers,
  canManage,
}: {
  customers: CustomerRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState<CustomerRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function confirmDelete() {
    const target = deleting;
    if (!target || isPending) return;
    setDeleteError(null);
    startTransition(async () => {
      try {
        const res = await deleteCustomerAction({ customerId: target.id });
        if (!res.ok) {
          setDeleteError(res.error);
          return;
        }
        setDeleting(null);
        router.refresh();
      } catch {
        setDeleteError("Unable to delete this customer. Please try again.");
      }
    });
  }

  if (customers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center">
        <p className="text-sm text-muted-foreground">No customers yet.</p>
        {canManage ? (
          <p className="mt-1 text-sm">
            <Link href="/customers/new" className="text-primary hover:underline">
              Add your first customer
            </Link>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border">
        <ul className="divide-y divide-border">
          {customers.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/customers/${c.id}`}
                  className="truncate text-sm font-medium hover:underline max-md:block max-md:min-h-11 max-md:py-3"
                >
                  {c.name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {[c.email, c.company, c.phone].filter(Boolean).join(" · ") ||
                    "No contact details"}
                </p>
              </div>
              {canManage ? (
                <div className="flex items-center gap-1">
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    aria-label={`Edit ${c.name}`}
                    className="max-md:min-h-11"
                  >
                    <Link href={`/customers/${c.id}/edit`}>
                      <Pencil className="size-4" aria-hidden />
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete ${c.name}`}
                    className="max-md:min-h-11"
                    disabled={isPending}
                    onClick={() => {
                      setDeleteError(null);
                      setDeleting(c);
                    }}
                  >
                    <Trash2 className="size-4 text-destructive" aria-hidden />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !isPending) setDeleting(null);
        }}
      >
        <DialogContent showCloseButton={!isPending} aria-busy={isPending}>
          <DialogHeader>
            <DialogTitle>Delete customer?</DialogTitle>
            <DialogDescription>
              {deleting ? (
                <>
                  This will remove <strong>{deleting.name}</strong> from your customer list. This
                  cannot be undone.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {deleteError ? (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={isPending}>
              {isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
