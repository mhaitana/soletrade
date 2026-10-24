"use client";

import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/features/admin/components/confirm-action-dialog";
import { assignSupportTicketAction } from "@/features/admin/api/actions";

export function AssignTicketDialog({
  ticketId,
  ticketSubject,
  assignees,
  currentAssignedAdminId,
}: {
  ticketId: string;
  ticketSubject: string;
  assignees: Array<{ id: string; fullName: string; email: string }>;
  currentAssignedAdminId?: string;
}) {
  const options = assignees.map((a) => ({
    value: a.id,
    label: `${a.fullName} (${a.email})`,
  }));

  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="outline" size="sm" disabled={assignees.length === 0}>
          {currentAssignedAdminId ? "Reassign" : "Assign"}
        </Button>
      }
      title="Assign support ticket"
      description={`"${ticketSubject}" — choosing a staff member records the assignment in the audit log.`}
      hidden={{ ticketId }}
      fields={[
        {
          name: "assignedAdminId",
          label: "Assign to",
          type: "select",
          required: true,
          options,
          defaultValue: currentAssignedAdminId,
          helperText: assignees.length === 0 ? "No active staff available to assign." : undefined,
        },
        {
          name: "reason",
          label: "Note (optional)",
          type: "textarea",
          rows: 2,
          placeholder: "Context for this assignment.",
        },
      ]}
      action={(input) =>
        assignSupportTicketAction({
          ticketId: input.ticketId,
          assignedAdminId: input.assignedAdminId,
          reason: input.reason || undefined,
        })
      }
      submitLabel="Assign ticket"
      successMessage="Support ticket assigned."
    />
  );
}
