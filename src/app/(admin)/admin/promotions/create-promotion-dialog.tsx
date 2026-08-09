"use client";

import * as React from "react";
import { useEffect, useActionState, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Plus } from "lucide-react";
import { createPromotionAction, type CreatePromotionResult } from "@/app/(admin)/admin/actions";

const DISCOUNT_TYPES = [
  { value: "percentage", label: "Percentage off" },
  { value: "fixed_amount", label: "Fixed amount off" },
] as const;

const DURATIONS = [
  { value: "once", label: "Once" },
  { value: "repeating", label: "Repeating (N months)" },
  { value: "forever", label: "Forever" },
] as const;

const CURRENCIES = [
  { value: "AUD", label: "AUD" },
  { value: "NZD", label: "NZD" },
  { value: "USD", label: "USD" },
] as const;

const fieldClass =
  "flex h-9 max-md:h-11 w-full rounded-md border border-input bg-background px-3 text-sm max-md:text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const textareaClass =
  "flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {children}
    </p>
  );
}

export function CreatePromotionDialog() {
  const [open, setOpen] = useState(false);
  const [discountType, setDiscountType] = useState<string>("percentage");
  const [duration, setDuration] = useState<string>("once");
  const [newCustomersOnly, setNewCustomersOnly] = useState(false);

  const [state, formAction, pending] = useActionState(
    async (_prev: CreatePromotionResult | null, fd: FormData): Promise<CreatePromotionResult> => {
      const input = {
        name: String(fd.get("name") ?? ""),
        internalDescription: String(fd.get("internalDescription") ?? "") || undefined,
        publicCode: String(fd.get("publicCode") ?? "") || undefined,
        currency: String(fd.get("currency") ?? "AUD"),
        discountType: String(fd.get("discountType") ?? "percentage"),
        percentOff: fd.get("percentOff") ? Number(fd.get("percentOff")) : undefined,
        amountOffCents: fd.get("amountOffCents") ? Number(fd.get("amountOffCents")) : undefined,
        duration: String(fd.get("duration") ?? "once"),
        durationInMonths: fd.get("durationInMonths")
          ? Number(fd.get("durationInMonths"))
          : undefined,
        maxRedemptions: fd.get("maxRedemptions") ? Number(fd.get("maxRedemptions")) : undefined,
        newCustomersOnly: fd.get("newCustomersOnly") === "on",
        reason: String(fd.get("reason") ?? ""),
      };
      return createPromotionAction(input);
    },
    null,
  );

  // Close on success — adjust during render (avoids setState-in-effect).
  const [closedFor, setClosedFor] = useState<CreatePromotionResult | null>(null);
  if (state && state.ok && state !== closedFor) {
    setClosedFor(state);
    setOpen(false);
  }

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success("Promotion created.");
    else if (!state.fieldErrors) toast.error(state.error);
  }, [state]);

  const fe = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 size-4" />
          New promotion
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create promotion</DialogTitle>
          <DialogDescription>
            Creates the coupon on Stripe automatically. If you enter a public code, a shareable
            Stripe promotion code is created too — no need to open the Stripe dashboard. Every field
            is audit-logged with your reason.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="promo-name">Name *</Label>
              <Input id="promo-name" name="name" required placeholder="Summer launch discount" />
              <FieldError>{fe?.name?.[0]}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="promo-public-code">Public code (optional)</Label>
              <Input
                id="promo-public-code"
                name="publicCode"
                placeholder="SUMMER25"
                autoCapitalize="characters"
                spellCheck={false}
                aria-describedby="promo-public-code-help"
              />
              <p id="promo-public-code-help" className="text-xs text-muted-foreground">
                Creates a shareable /signup?promo=CODE link.
              </p>
              <FieldError>{fe?.publicCode?.[0]}</FieldError>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="promo-currency">Currency *</Label>
              <select id="promo-currency" name="currency" defaultValue="AUD" className={fieldClass}>
                {CURRENCIES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <FieldError>{fe?.currency?.[0]}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="promo-max-redemptions">Max redemptions (optional)</Label>
              <Input
                id="promo-max-redemptions"
                name="maxRedemptions"
                type="number"
                min={1}
                step={1}
                placeholder="100"
              />
              <FieldError>{fe?.maxRedemptions?.[0]}</FieldError>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="promo-discount-type">Discount type *</Label>
              <select
                id="promo-discount-type"
                name="discountType"
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value)}
                className={fieldClass}
              >
                {DISCOUNT_TYPES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <FieldError>{fe?.discountType?.[0]}</FieldError>
            </div>
            {discountType === "percentage" ? (
              <div className="space-y-1.5">
                <Label htmlFor="promo-percent-off">Percent off (1–100) *</Label>
                <Input
                  id="promo-percent-off"
                  name="percentOff"
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  placeholder="25"
                />
                <FieldError>{fe?.percentOff?.[0]}</FieldError>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="promo-amount-off">Amount off (cents) *</Label>
                <Input
                  id="promo-amount-off"
                  name="amountOffCents"
                  type="number"
                  min={1}
                  step={1}
                  placeholder="2500 (= $25.00)"
                />
                <FieldError>{fe?.amountOffCents?.[0]}</FieldError>
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="promo-duration">Duration *</Label>
              <select
                id="promo-duration"
                name="duration"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className={fieldClass}
              >
                {DURATIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <FieldError>{fe?.duration?.[0]}</FieldError>
            </div>
            {duration === "repeating" ? (
              <div className="space-y-1.5">
                <Label htmlFor="promo-duration-months">Duration in months *</Label>
                <Input
                  id="promo-duration-months"
                  name="durationInMonths"
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  placeholder="3"
                />
                <FieldError>{fe?.durationInMonths?.[0]}</FieldError>
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="promo-internal">Internal description (optional)</Label>
            <textarea
              id="promo-internal"
              name="internalDescription"
              rows={2}
              className={textareaClass}
              placeholder="Notes for staff — not shown to customers."
            />
            <FieldError>{fe?.internalDescription?.[0]}</FieldError>
          </div>

          <label className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent">
            <input
              type="checkbox"
              name="newCustomersOnly"
              checked={newCustomersOnly}
              onChange={(e) => setNewCustomersOnly(e.target.checked)}
              className="size-4 rounded-sm border-input accent-brand-blue"
            />
            <span>New customers only</span>
          </label>

          <div className="space-y-1.5">
            <Label htmlFor="promo-reason">Reason *</Label>
            <textarea
              id="promo-reason"
              name="reason"
              required
              rows={3}
              className={textareaClass}
              placeholder="Why is this promotion being created?"
            />
            <FieldError>{fe?.reason?.[0]}</FieldError>
          </div>

          {state && !state.ok && !state.fieldErrors ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create promotion"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
