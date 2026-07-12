"use client";

import { Button } from "@/shared/ui/button";
import { ConfirmActionDialog } from "@/platform/admin/components/confirm-action-dialog";
import { restoreUserAction } from "@/app/(admin)/admin/actions";

export function RestoreUserDialog({ userId, userName }: { userId: string; userName: string }) {
  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="outline" className="w-full justify-start">
          Restore account…
        </Button>
      }
      title={`Restore ${userName}?`}
      description="The account regains access immediately. The action is recorded in the audit log with your reason."
      hidden={{ userId }}
      fields={[
        {
          name: "reason",
          label: "Reason",
          type: "textarea",
          required: true,
          rows: 4,
          placeholder: "Why is this account being restored?",
        },
      ]}
      action={(input) => restoreUserAction({ userId: input.userId, reason: input.reason })}
      submitLabel="Restore account"
      successMessage="Account restored."
    />
  );
}
