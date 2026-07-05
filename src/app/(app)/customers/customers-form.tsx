"use client";

import { useEffect, useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  createCustomerAction,
  updateCustomerAction,
  type CreateCustomerResult,
  type UpdateCustomerResult,
} from "./actions";
import type { CustomerRow } from "@/platform/customers";

type Result = CreateCustomerResult | UpdateCustomerResult;

export function CustomerForm({
  mode,
  customer,
}: {
  mode: "create" | "edit";
  customer?: CustomerRow;
}) {
  const router = useRouter();
  const isEdit = mode === "edit";

  const [state, action, pending] = useActionState(
    async (_prev: Result | null, formData: FormData): Promise<Result> => {
      const input = {
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        company: String(formData.get("company") ?? ""),
        notes: String(formData.get("notes") ?? ""),
      };
      if (isEdit && customer) {
        return updateCustomerAction({ customerId: customer.id, ...input });
      }
      return createCustomerAction(input);
    },
    null,
  );

  useEffect(() => {
    if (state?.ok) router.push("/customers");
  }, [state, router]);

  const error = state && !state.ok ? state.error : "";
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={120}
          defaultValue={customer?.name ?? ""}
          placeholder="Jane Smith"
          aria-invalid={Boolean(fieldErrors?.name)}
        />
        {fieldErrors?.name?.[0] ? (
          <p className="text-sm text-destructive">{fieldErrors.name[0]}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          defaultValue={customer?.email ?? ""}
          placeholder="jane@example.com"
          aria-invalid={Boolean(fieldErrors?.email)}
        />
        {fieldErrors?.email?.[0] ? (
          <p className="text-sm text-destructive">{fieldErrors.email[0]}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            name="phone"
            defaultValue={customer?.phone ?? ""}
            placeholder="+61 4…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="company">Company</Label>
          <Input
            id="company"
            name="company"
            defaultValue={customer?.company ?? ""}
            placeholder="Acme Pty Ltd"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          maxLength={2000}
          defaultValue={customer?.notes ?? ""}
          placeholder="Internal notes about this customer."
          className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {error && !fieldErrors ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isEdit ? "Save changes" : "Add customer"}
        </Button>
        <Button asChild type="button" variant="outline">
          <Link href="/customers">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
