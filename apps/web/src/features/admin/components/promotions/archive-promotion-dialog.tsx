"use client";

import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/features/admin/components/confirm-action-dialog";
import { archivePromotionAction } from "@/features/admin/api/actions";

export function ArchivePromotionDialog({
  promotionId,
  promotionName,
}: {
  promotionId: string;
  promotionName: string;
}) {
  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
          <Archive className="mr-1.5 size-3.5" />
          Deactivate
        </Button>
      }
      title={`Deactivate "${promotionName}"?`}
      description="Archives the promotion locally and disables the coupon (and promotion code) on Stripe so it can no longer be redeemed. This cannot be undone from the admin portal. The action is audit-logged."
      hidden={{ promotionId }}
      fields={[
        {
          name: "reason",
          label: "Reason",
          type: "textarea",
          required: true,
          rows: 3,
          placeholder: "Why is this promotion being deactivated?",
        },
      ]}
      action={(input) =>
        archivePromotionAction({ promotionId: input.promotionId, reason: input.reason })
      }
      submitLabel="Deactivate"
      destructive
      successMessage="Promotion deactivated on Stripe."
    />
  );
}
