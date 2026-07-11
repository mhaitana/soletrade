"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
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
import {
  cancelSubscriptionAction,
  previewCancelSubscriptionAction,
  switchBillingIntervalAction,
  type CancelSubscriptionPreviewResult,
} from "./actions";
import { CancellationModal, type CancelOptionChoice } from "./cancellation-modal";
import type { BillingInterval } from "@/server/db/enums";

interface BillingManageActionsProps {
  /** Current interval (null = not started, but this component only renders when active). */
  interval: BillingInterval | null;
}

/**
 * Manage-billing actions shown on /billing when the workspace has an active subscription
 * and the user can `manage:billing`. Two destructive-ish actions, each gated by a
 * confirmation dialog:
 *   - **Switch interval**: flip monthly↔annual. Effective next cycle (no Stripe proration).
 *   - **Cancel subscription**: cancels the whole subscription (Branch B offboarding, brief
 *     §10.6). The CancellationModal offers keep-until-end or immediate card refund.
 *
 * Money renders use `tabular-nums` per workspace rule. Errors surface inline via
 * `role="alert"` (WCAG: screen-reader announcements).
 */
export function BillingManageActions({ interval }: BillingManageActionsProps) {
  const router = useRouter();
  const [switchPending, startSwitch] = useTransition();
  const [cancelPending, startCancel] = useTransition();
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelPreview, setCancelPreview] = useState<Extract<
    CancelSubscriptionPreviewResult,
    { ok: true }
  > | null>();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [previewingCancel, setPreviewingCancel] = useState(false);

  const targetInterval: BillingInterval = interval === "annual" ? "monthly" : "annual";
  const switchLabel = `Switch to ${targetInterval === "annual" ? "annual" : "monthly"}`;

  function onSwitch() {
    setSwitchError(null);
    startSwitch(async () => {
      const res = await switchBillingIntervalAction(targetInterval);
      if (!res.ok) {
        setSwitchError(res.error);
        return;
      }
      router.refresh();
    });
  }

  async function onCancelClick() {
    setCancelError(null);
    setPreviewingCancel(true);
    const res = await previewCancelSubscriptionAction();
    setPreviewingCancel(false);
    if (!res.ok) {
      setCancelError(res.error);
      return;
    }
    setCancelPreview(res);
    setCancelOpen(true);
  }

  function onConfirmCancel(value: string) {
    // Map the modal's option value back to the cancel-all action's expected input.
    // The preview's keep option is "keep_until_end_of_cycle"; the action takes
    // "keep_until_end". immediate_refund passes through unchanged.
    const actionOption = value === "keep_until_end_of_cycle" ? "keep_until_end" : value;
    setCancelError(null);
    startCancel(async () => {
      const res = await cancelSubscriptionAction(actionOption);
      if (!res.ok) {
        setCancelError(res.error);
        return;
      }
      setCancelOpen(false);
      setCancelPreview(null);
      router.refresh();
    });
  }

  const cancelChoices: CancelOptionChoice[] = cancelPreview
    ? cancelPreview.options.map((o) => {
        if (o.option === "immediate_refund") {
          return {
            value: "immediate_refund",
            label: "Refund to payment method",
            description:
              "Cancel now. Unused time across all modules is refunded to your original payment method.",
            amountCents: o.amountCents,
            recommended: o.recommended,
          };
        }
        return {
          value: "keep_until_end_of_cycle",
          label: "Keep until end of cycle",
          description:
            "Your subscription stays active until the current billing period ends, then ends automatically. No refund is issued.",
          amountCents: o.amountCents,
          recommended: o.recommended,
        };
      })
    : [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" disabled={switchPending}>
            {switchPending ? "Switching…" : switchLabel}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch to {targetInterval} billing?</DialogTitle>
            <DialogDescription>
              Your prices update to {targetInterval} billing starting next cycle. No charge or
              credit is issued now — the change takes effect on your next invoice.
            </DialogDescription>
          </DialogHeader>
          {switchError ? (
            <p role="alert" className="text-sm text-destructive">
              {switchError}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={switchPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={onSwitch} disabled={switchPending}>
              {switchPending ? "Switching…" : "Confirm switch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Button
        variant="destructive"
        disabled={cancelPending || previewingCancel}
        onClick={() => void onCancelClick()}
      >
        {previewingCancel ? "Calculating…" : cancelPending ? "Cancelling…" : "Cancel subscription"}
      </Button>
      {cancelError ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {cancelError}
        </p>
      ) : null}

      <CancellationModal
        key={cancelPreview ? "sub-cancel" : "none"}
        open={cancelOpen}
        onOpenChange={(o) => {
          setCancelOpen(o);
          if (!o) setCancelPreview(null);
        }}
        title="Cancel your subscription?"
        description="This ends your subscription and disables all paid modules (Branch B — offboarding). You can keep access until the current billing period ends, or cancel now for a pro-rated refund to your payment method. No platform credit is issued when cancelling the whole subscription."
        periodEnd={cancelPreview?.periodEnd ?? null}
        options={cancelChoices}
        onConfirm={onConfirmCancel}
        pending={cancelPending}
        error={cancelError}
      />
    </div>
  );
}
