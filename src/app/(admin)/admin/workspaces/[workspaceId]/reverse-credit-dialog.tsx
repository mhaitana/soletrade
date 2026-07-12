"use client";

import { Button } from "@/shared/ui/button";
import { ConfirmActionDialog } from "@/platform/admin/components/confirm-action-dialog";
import { reverseCreditAction } from "@/app/(admin)/admin/actions";

export function ReverseCreditDialog({
  entryId,
  workspaceId,
  entryReason,
}: {
  entryId: string;
  workspaceId: string;
  entryReason: string;
}) {
  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
          Reverse
        </Button>
      }
      title="Reverse credit entry?"
      description={`Appends a reversing entry to the ledger. The original entry is never edited or deleted (Principle #7 & #12). Reversing: "${entryReason}".`}
      hidden={{ entryId, workspaceId }}
      fields={[
        {
          name: "reason",
          label: "Reason",
          type: "textarea",
          required: true,
          rows: 3,
          placeholder: "Why is this entry being reversed?",
        },
      ]}
      action={(input) =>
        reverseCreditAction({
          entryId: input.entryId,
          workspaceId: input.workspaceId,
          reason: input.reason,
        })
      }
      submitLabel="Reverse entry"
      destructive
      successMessage="Credit entry reversed."
    />
  );
}
