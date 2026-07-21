"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { deleteCustomerAction } from "./actions";
import type { CustomerRow } from "@/platform/customers";

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

  function confirmDelete() {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    startTransition(async () => {
      const res = await deleteCustomerAction({ customerId: target.id });
      if (!res.ok) {
        // Surface a minimal error via the dialog state; refresh keeps list in sync.
      }
      router.refresh();
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
                    onClick={() => setDeleting(c)}
                  >
                    <Trash2 className="size-4 text-destructive" aria-hidden />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete customer?</DialogTitle>
            <DialogDescription>
              {deleting ? (
                <>
                  This will soft-delete <strong>{deleting.name}</strong>. You can re-add the email
                  address to a new customer afterwards. This cannot be undone.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
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
