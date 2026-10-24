"use client";

import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/features/admin/components/confirm-action-dialog";
import { suspendWorkspaceAction } from "@/features/admin/api/actions";

export function SuspendWorkspaceDialog({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="destructive" className="w-full justify-start">
          Suspend workspace…
        </Button>
      }
      title={`Suspend ${workspaceName}?`}
      description="The workspace and its members lose access immediately. The action is recorded in the audit log with your reason. The workspace can be restored later."
      hidden={{ workspaceId }}
      fields={[
        {
          name: "reason",
          label: "Reason",
          type: "textarea",
          required: true,
          rows: 4,
          placeholder: "Why is this workspace being suspended?",
        },
      ]}
      action={(input) =>
        suspendWorkspaceAction({ workspaceId: input.workspaceId, reason: input.reason })
      }
      submitLabel="Suspend workspace"
      destructive
      successMessage="Workspace suspended."
    />
  );
}
