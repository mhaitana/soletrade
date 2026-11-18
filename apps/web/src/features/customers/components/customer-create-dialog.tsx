"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRequestId } from "@/hooks/use-request-id";
import Link from "next/link";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/responsive-dialog";
import type { PickerCustomer } from "@/types/customer-picker";
import { createCustomerAction } from "@/features/customers/api/actions";

const CUSTOMER_SAVE_UNCONFIRMED = "We couldn’t confirm whether this customer was saved.";

/**
 * Inline customer-creation dialog used by the invoice + quote forms so a user can
 * add a customer without navigating to /customers/new. Collects only name + email
 * (both required) - the minimum needed to send an invoice/quote. The full field set
 * (phone/company/notes) is still editable later from /customers/[id].
 *
 * `onCreated` receives the new customer so the parent form can append it to its
 * picker list and auto-select it. Reuses `createCustomerAction`, which returns the
 * friendly "A customer with that email already exists." message on a collision.
 */

/** The minimal customer shape the picker needs (a subset of `CustomerRow`). */
export type { PickerCustomer } from "@/types/customer-picker";

export function CustomerCreateDialog({
  onCreated,
}: {
  onCreated: (customer: PickerCustomer) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();
  // The dialog stays mounted between customers, so start a new draft after each save.
  const { requestId, renew: renewRequestId } = useRequestId();

  function reset() {
    setName("");
    setEmail("");
    setError("");
    setFieldErrors(undefined);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (isPending) return;
    setError("");
    setFieldErrors(undefined);
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }
    if (!trimmedEmail) {
      setError("Email is required - needed to send the invoice/quote.");
      return;
    }

    startTransition(async () => {
      let res: Awaited<ReturnType<typeof createCustomerAction>>;
      try {
        res = await createCustomerAction({
          requestId,
          name: trimmedName,
          email: trimmedEmail,
          phone: "",
          company: "",
          notes: "",
        });
      } catch {
        setError(CUSTOMER_SAVE_UNCONFIRMED);
        return;
      }
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors);
        return;
      }
      toast.success("Customer created");
      onCreated({ id: res.customerId, name: trimmedName, email: trimmedEmail, company: null });
      renewRequestId();
      reset();
      setOpen(false);
    });
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isPending) return;
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <ResponsiveDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Plus className="size-4" aria-hidden />
          Add customer
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent showCloseButton={!isPending} aria-busy={isPending}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Add customer</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Create a new customer for this document. Name and email are required - the email is used
            to send the invoice or quote.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cc-name">Name</Label>
            <Input
              id="cc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              maxLength={120}
              disabled={isPending}
              aria-invalid={Boolean(fieldErrors?.name?.[0])}
            />
            {fieldErrors?.name?.[0] ? (
              <p className="text-sm text-destructive">{fieldErrors.name[0]}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-email">Email</Label>
            <Input
              id="cc-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={120}
              disabled={isPending}
              aria-invalid={Boolean(fieldErrors?.email?.[0])}
            />
            {fieldErrors?.email?.[0] ? (
              <p className="text-sm text-destructive">{fieldErrors.email[0]}</p>
            ) : null}
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error === CUSTOMER_SAVE_UNCONFIRMED ? (
                <>
                  {CUSTOMER_SAVE_UNCONFIRMED}{" "}
                  <Link
                    href="/customers"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline underline-offset-4"
                  >
                    Check customers
                    <span className="sr-only"> (opens in a new tab)</span>
                  </Link>
                  , or save again; this won’t create a second customer.
                </>
              ) : (
                error
              )}
            </p>
          ) : null}
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose asChild>
              <Button type="button" variant="outline" disabled={isPending}>
                Cancel
              </Button>
            </ResponsiveDialogClose>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding…" : "Add customer"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
