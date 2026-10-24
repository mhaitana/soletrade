"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/features/admin/components/confirm-action-dialog";
import { syncPromotionAction } from "@/features/admin/api/actions";

export function SyncPromotionDialog({ promotionId }: { promotionId: string }) {
  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="outline" size="sm">
          <RefreshCw className="mr-1.5 size-3.5" />
          Sync
        </Button>
      }
      title="Sync redemption data from Stripe?"
      description="Refetches this coupon's live redemption count and validity from Stripe and updates the local record. The action is audit-logged."
      hidden={{ promotionId }}
      action={(input) => syncPromotionAction({ promotionId: input.promotionId })}
      submitLabel="Sync"
      successMessage="Synced redemption data from Stripe."
    />
  );
}
