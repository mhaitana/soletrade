"use client";

import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/features/admin/components/confirm-action-dialog";
import { revokeSupportAccessAction } from "@/features/admin/api/actions";

/**
 * Ends the active customer-approved support access session. Rendered in the
 * AdminShell banner. Revalidates the admin layout so the banner disappears.
 */
export function ExitSessionButton({ sessionId }: { sessionId: string }) {
  return (
    <ConfirmActionDialog
      trigger={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 border-warning/50 bg-warning/15 text-warning hover:bg-warning/25 hover:text-warning"
        >
          Exit Session
        </Button>
      }
      title="End support access session?"
      description="The customer-approved support access session will be revoked immediately. The action is recorded in the audit log."
      hidden={{ sessionId }}
      action={(input) => revokeSupportAccessAction({ sessionId: input.sessionId })}
      submitLabel="Exit Session"
      destructive
      successMessage="Support access session ended."
    />
  );
}
