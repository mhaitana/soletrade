"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { createCustomerAction } from "./actions";

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
export interface PickerCustomer {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
}

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

  function reset() {
    setName("");
    setEmail("");
    setError("");
    setFieldErrors(undefined);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
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
      const res = await createCustomerAction({
        name: trimmedName,
        email: trimmedEmail,
        phone: "",
        company: "",
        notes: "",
      });
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors);
        return;
      }
      onCreated({ id: res.customerId, name: trimmedName, email: trimmedEmail, company: null });
      reset();
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Plus className="size-4" aria-hidden />
          Add customer
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add customer</DialogTitle>
          <DialogDescription>
            Create a new customer for this document. Name and email are required - the email is used
            to send the invoice or quote.
          </DialogDescription>
        </DialogHeader>
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
              aria-invalid={Boolean(fieldErrors?.email?.[0])}
            />
            {fieldErrors?.email?.[0] ? (
              <p className="text-sm text-destructive">{fieldErrors.email[0]}</p>
            ) : null}
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding…" : "Add customer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
