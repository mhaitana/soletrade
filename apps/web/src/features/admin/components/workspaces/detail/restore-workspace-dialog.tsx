"use client";

import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/features/admin/components/confirm-action-dialog";
import { restoreWorkspaceAction } from "@/features/admin/api/actions";

export function RestoreWorkspaceDialog({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="outline" className="w-full justify-start">
          Restore workspace…
        </Button>
      }
      title={`Restore ${workspaceName}?`}
      description="The workspace and its members regain access immediately. The action is recorded in the audit log with your reason."
      hidden={{ workspaceId }}
      fields={[
        {
          name: "reason",
          label: "Reason",
          type: "textarea",
          required: true,
          rows: 4,
          placeholder: "Why is this workspace being restored?",
        },
      ]}
      action={(input) =>
        restoreWorkspaceAction({ workspaceId: input.workspaceId, reason: input.reason })
      }
      submitLabel="Restore workspace"
      successMessage="Workspace restored."
    />
  );
}
