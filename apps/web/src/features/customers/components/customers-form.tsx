"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createCustomerAction,
  updateCustomerAction,
  type CreateCustomerResult,
  type UpdateCustomerResult,
} from "@/features/customers/api/actions";
import type { CustomerRow } from "@/lib/domain/customers/types";
import {
  HaiPrefillNotice,
  fieldString,
  useHaiFormPrefill,
} from "@/components/assisted-form/hai-form-prefill";

type Result = CreateCustomerResult | UpdateCustomerResult;

const CUSTOMER_SAVE_UNCONFIRMED = "We couldn’t confirm whether this customer was saved.";

export function CustomerForm({
  mode,
  customer,
}: {
  mode: "create" | "edit";
  customer?: CustomerRow;
}) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action, pending] = useActionState(
    async (_prev: Result | null, formData: FormData): Promise<Result> => {
      const input = {
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        company: String(formData.get("company") ?? ""),
        notes: String(formData.get("notes") ?? ""),
      };
      try {
        if (isEdit && customer) {
          return await updateCustomerAction({ customerId: customer.id, ...input });
        }
        return await createCustomerAction(input);
      } catch {
        return {
          ok: false,
          error: CUSTOMER_SAVE_UNCONFIRMED,
        };
      }
    },
    null,
  );

  useEffect(() => {
    if (state?.ok) router.push("/customers");
  }, [state, router]);

  const error = state && !state.ok ? state.error : "";
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  }

  const haiNotice = useHaiFormPrefill(
    mode === "create" ? "customer.create" : "customer.edit",
    (fields) => {
      const applied: string[] = [];
      const labels: Record<string, string> = {
        name: "customer name",
        email: "email",
        phone: "phone",
        company: "company",
        notes: "notes",
      };
      for (const key of Object.keys(labels)) {
        const value = fieldString(fields, key);
        if (value === undefined) continue;
        const control = formRef.current?.elements.namedItem(key);
        if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
          control.value = value;
          applied.push(labels[key]!);
        }
      }
      return { appliedFields: applied };
    },
  );

  return (
    <form ref={formRef} action={action} onSubmit={onSubmit} aria-busy={pending}>
      <fieldset disabled={pending} className="min-w-0 space-y-4 border-0 p-0">
        <HaiPrefillNotice notice={haiNotice} />
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
              maxLength={120}
              defaultValue={customer?.phone ?? ""}
              placeholder="+61 4…"
              aria-invalid={Boolean(fieldErrors?.phone)}
              aria-describedby={fieldErrors?.phone?.[0] ? "phone-error" : undefined}
            />
            {fieldErrors?.phone?.[0] ? (
              <p id="phone-error" className="text-sm text-destructive">
                {fieldErrors.phone[0]}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company">Company</Label>
            <Input
              id="company"
              name="company"
              maxLength={120}
              defaultValue={customer?.company ?? ""}
              placeholder="Acme Pty Ltd"
              aria-invalid={Boolean(fieldErrors?.company)}
              aria-describedby={fieldErrors?.company?.[0] ? "company-error" : undefined}
            />
            {fieldErrors?.company?.[0] ? (
              <p id="company-error" className="text-sm text-destructive">
                {fieldErrors.company[0]}
              </p>
            ) : null}
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
                </Link>{" "}
                before trying again.
              </>
            ) : (
              error
            )}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Add customer"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => router.push("/customers")}
          >
            Cancel
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
