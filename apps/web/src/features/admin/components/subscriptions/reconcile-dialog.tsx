"use client";

import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/features/admin/components/confirm-action-dialog";
import { reconcileSubscriptionAction } from "@/features/admin/api/actions";

export function ReconcileDialog({
  workspaceId,
  stripeSubscriptionId,
}: {
  workspaceId: string;
  stripeSubscriptionId?: string | null;
}) {
  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="outline" size="sm">
          Reconcile
        </Button>
      }
      title="Reconcile subscription with Stripe?"
      description={
        stripeSubscriptionId
          ? `Refetches subscription "${stripeSubscriptionId}" from Stripe and resyncs local metadata. The action is audit-logged.`
          : "Refetches the workspace's Stripe subscription and resyncs local metadata. The action is audit-logged."
      }
      hidden={{ workspaceId }}
      fields={[
        {
          name: "reason",
          label: "Reason",
          type: "textarea",
          required: true,
          rows: 3,
          placeholder: "Why is this subscription being reconciled?",
        },
      ]}
      action={(input) =>
        reconcileSubscriptionAction({ workspaceId: input.workspaceId, reason: input.reason })
      }
      submitLabel="Reconcile"
      successMessage="Subscription reconciled with Stripe."
    />
  );
}
