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
import { cancelSubscriptionAction, switchBillingIntervalAction } from "./actions";
import type { BillingInterval } from "@/server/db/schema/enums";

interface BillingManageActionsProps {
  /** Current interval (null = not started, but this component only renders when active). */
  interval: BillingInterval | null;
}

/**
 * Manage-billing actions shown on /billing when the workspace has an active subscription
 * and the user can `manage:billing`. Two destructive-ish actions, each gated by a
 * confirmation dialog:
 *   - **Switch interval**: flip monthly↔annual. Effective next cycle (no Stripe proration).
 *   - **Cancel subscription**: cancels the whole subscription; per-module prorated refunds
 *     issue via webhook. Completes asynchronously — the page may briefly show "active".
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
  const [cancelling, setCancelling] = useState(false);

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

  function onCancel() {
    setCancelError(null);
    startCancel(async () => {
      const res = await cancelSubscriptionAction();
      if (!res.ok) {
        setCancelError(res.error);
        return;
      }
      setCancelling(true);
      router.refresh();
    });
  }

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

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="destructive" disabled={cancelPending || cancelling}>
            {cancelling ? "Cancellation processing" : "Cancel subscription"}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel your subscription?</DialogTitle>
            <DialogDescription>
              This cancels your subscription and disables all paid modules. Unused time in the
              current billing period is refunded to your credit balance per module, pro-rated. The
              cancellation completes once Stripe confirms it (usually within a few seconds).
            </DialogDescription>
          </DialogHeader>
          {cancelError ? (
            <p role="alert" className="text-sm text-destructive">
              {cancelError}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={cancelPending}>
                Keep subscription
              </Button>
            </DialogClose>
            <Button variant="destructive" onClick={onCancel} disabled={cancelPending}>
              {cancelPending ? "Cancelling…" : "Cancel subscription"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
