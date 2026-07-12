"use client";

import { Button } from "@/shared/ui/button";
import { ConfirmActionDialog } from "@/platform/admin/components/confirm-action-dialog";
import { updateFeatureFlagAction } from "@/app/(admin)/admin/actions";

export function UpdateFlagDialog({
  flagId,
  flagKey,
  currentEnabled,
}: {
  flagId: string;
  flagKey: string;
  currentEnabled: boolean;
}) {
  const targetEnabled = !currentEnabled;
  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="outline" size="sm">
          {currentEnabled ? "Disable" : "Enable"}
        </Button>
      }
      title={`${targetEnabled ? "Enable" : "Disable"} feature flag?`}
      description={`Flag "${flagKey}" will be turned ${targetEnabled ? "ON" : "OFF"}. The change is audit-logged with your reason.`}
      hidden={{ flagId, enabled: String(targetEnabled) }}
      fields={[
        {
          name: "reason",
          label: "Reason",
          type: "textarea",
          required: true,
          rows: 3,
          placeholder: "Why is this flag being toggled?",
        },
      ]}
      action={(input) =>
        updateFeatureFlagAction({
          flagId: input.flagId,
          enabled: input.enabled === "true",
          reason: input.reason,
        })
      }
      submitLabel={targetEnabled ? "Enable flag" : "Disable flag"}
      destructive={!targetEnabled}
      successMessage={`Feature flag ${targetEnabled ? "enabled" : "disabled"}.`}
    />
  );
}
