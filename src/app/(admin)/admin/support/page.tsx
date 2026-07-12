import "server-only";
import * as React from "react";
import { LifeBuoy } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { listSupportTickets } from "@/platform/admin/services/admin-support";
import { listAssignableAdminStaff } from "@/platform/admin/services/admin-auth";
import {
  AdminPageHeader,
  StatusBadge,
  AdminTable,
  AdminTh,
  AdminTd,
  AdminTr,
  EmptyRow,
  Mono,
} from "@/platform/admin/components/admin-ui";
import { AssignTicketDialog } from "./assign-ticket-dialog";

export default async function AdminSupportPage() {
  await requireAdminContext("view:support_tickets");
  const [tickets, assignees] = await Promise.all([
    listSupportTickets(),
    listAssignableAdminStaff(),
  ]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={LifeBuoy}
        title="Customer Support Queue"
        subtitle="Review support cases, prioritize urgency, and request time-limited customer support access."
      />

      <AdminTable caption="Support tickets">
        <thead>
          <tr>
            <AdminTh>Subject</AdminTh>
            <AdminTh>Requester ID</AdminTh>
            <AdminTh>Workspace ID</AdminTh>
            <AdminTh>Category</AdminTh>
            <AdminTh>Priority</AdminTh>
            <AdminTh>Status</AdminTh>
            <AdminTh className="text-right">Actions</AdminTh>
          </tr>
        </thead>
        <tbody>
          {tickets.length === 0 ? (
            <EmptyRow colSpan={7}>Support queue is currently empty.</EmptyRow>
          ) : (
            tickets.map((t) => (
              <AdminTr key={t.id}>
                <AdminTd className="font-medium text-foreground">{t.subject}</AdminTd>
                <AdminTd>
                  <Mono className="text-[11px] text-muted-foreground">{t.requesterUserId}</Mono>
                </AdminTd>
                <AdminTd>
                  <Mono className="text-[11px] text-muted-foreground">{t.workspaceId ?? "—"}</Mono>
                </AdminTd>
                <AdminTd className="capitalize text-muted-foreground">{t.category}</AdminTd>
                <AdminTd>
                  <StatusBadge status={t.priority} />
                </AdminTd>
                <AdminTd>
                  <StatusBadge status={t.status} />
                </AdminTd>
                <AdminTd className="text-right">
                  <AssignTicketDialog
                    ticketId={t.id}
                    ticketSubject={t.subject}
                    assignees={assignees}
                    currentAssignedAdminId={t.assignedAdminId}
                  />
                </AdminTd>
              </AdminTr>
            ))
          )}
        </tbody>
      </AdminTable>
    </div>
  );
}
