"use client";

import { Button } from "@/shared/ui/button";
import { ConfirmActionDialog } from "@/platform/admin/components/confirm-action-dialog";
import { requestSupportAccessAction } from "@/app/(admin)/admin/actions";
import { SUPPORT_SCOPES, ACCESS_LEVELS } from "@/app/(admin)/admin/actions-helpers";

const SCOPE_OPTIONS = SUPPORT_SCOPES.map((s) => ({
  value: s,
  label: s.replace(/_/g, " "),
}));

const ACCESS_LEVEL_OPTIONS = ACCESS_LEVELS.map((l) => ({
  value: l,
  label: l.replace(/_/g, " "),
}));

export function RequestAccessDialog({
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
          Request support access…
        </Button>
      }
      title={`Request support access to ${workspaceName}`}
      description="Creates a pending access request the customer must approve. Access is time-limited and scoped (Principle #3 & #15). The customer sees your reason and explanation."
      hidden={{ workspaceId }}
      fields={[
        {
          name: "scopes",
          label: "Requested scopes",
          type: "checkbox-group",
          required: true,
          options: SCOPE_OPTIONS,
          helperText: "Select every area you need to access.",
        },
        {
          name: "accessLevel",
          label: "Access level",
          type: "select",
          required: true,
          options: ACCESS_LEVEL_OPTIONS,
          defaultValue: "read_only",
          helperText:
            "metadata_only = no data, read_only = view only, guided_write = you act, customer watches.",
        },
        {
          name: "requestedDurationMinutes",
          label: "Duration (minutes, max 1440)",
          type: "number",
          required: true,
          defaultValue: "60",
          min: 1,
          max: 1440,
          step: 1,
        },
        {
          name: "reason",
          label: "Reason (internal)",
          type: "textarea",
          required: true,
          rows: 3,
          placeholder: "Why do you need access to this workspace?",
        },
        {
          name: "customerExplanation",
          label: "Customer-facing explanation (optional)",
          type: "textarea",
          rows: 3,
          placeholder: "What the customer will see when asked to approve.",
        },
      ]}
      action={(input) =>
        requestSupportAccessAction({
          workspaceId: input.workspaceId,
          scopes: input.scopes ? input.scopes.split(",").filter(Boolean) : [],
          accessLevel: input.accessLevel,
          requestedDurationMinutes: Number(input.requestedDurationMinutes),
          reason: input.reason,
          customerExplanation: input.customerExplanation || undefined,
        })
      }
      submitLabel="Submit request"
      successMessage="Support access request submitted. The customer must approve it."
    />
  );
}
