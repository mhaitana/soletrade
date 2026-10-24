"use client";

import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/features/admin/components/confirm-action-dialog";
import { suspendUserAction } from "@/features/admin/api/actions";

export function SuspendUserDialog({ userId, userName }: { userId: string; userName: string }) {
  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="destructive" className="w-full justify-start">
          Suspend account…
        </Button>
      }
      title={`Suspend ${userName}?`}
      description="The user loses access immediately. The action is recorded in the audit log with your reason. The account can be restored later."
      hidden={{ userId }}
      fields={[
        {
          name: "reason",
          label: "Reason",
          type: "textarea",
          required: true,
          rows: 4,
          placeholder: "Why is this account being suspended?",
        },
      ]}
      action={(input) => suspendUserAction({ userId: input.userId, reason: input.reason })}
      submitLabel="Suspend account"
      destructive
      successMessage="Account suspended."
    />
  );
}
