"use client";

import { Button } from "@/shared/ui/button";
import { ConfirmActionDialog } from "@/platform/admin/components/confirm-action-dialog";
import { retryWebhookAction } from "@/app/(admin)/admin/actions";

export function RetryWebhookDialog({
  webhookId,
  eventType,
}: {
  webhookId: string;
  /** Short label for the event being retried, shown in the dialog title. */
  eventType: string;
}) {
  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="outline" size="sm">
          Retry
        </Button>
      }
      title="Retry webhook event?"
      description={`Re-queues the "${eventType}" webhook event for delivery. The original delivery record is preserved; a new attempt is audit-logged.`}
      hidden={{ id: webhookId }}
      fields={[
        {
          name: "reason",
          label: "Reason",
          type: "textarea",
          required: true,
          rows: 3,
          placeholder: "Why is this webhook being retried?",
        },
      ]}
      action={(input) => retryWebhookAction({ id: input.id, reason: input.reason })}
      submitLabel="Retry event"
      successMessage="Webhook event re-queued."
    />
  );
}
