import "server-only";
import { getAdminDb } from "./db";
import type {
  SupportTicket,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
} from "@/platform/admin/types";
import { requireAdminContext } from "./admin-auth";
import { writeAdminAuditEvent } from "./admin-audit";

export async function listSupportTickets(): Promise<SupportTicket[]> {
  await requireAdminContext("view:support_tickets");
  const db = getAdminDb();

  const { data: rows } = await db
    .from("support_tickets")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (!rows) return [];

  return (
    rows as Array<{
      id: string;
      workspace_id?: string;
      requester_user_id: string;
      assigned_admin_id?: string;
      subject: string;
      description: string;
      category: SupportTicketCategory;
      priority: SupportTicketPriority;
      status: SupportTicketStatus;
      created_at: string;
      updated_at: string;
      resolved_at?: string;
    }>
  ).map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    requesterUserId: row.requester_user_id,
    assignedAdminId: row.assigned_admin_id,
    subject: row.subject,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
  }));
}

export async function assignSupportTicket(
  ticketId: string,
  assignedAdminId: string,
  reason?: string,
): Promise<void> {
  const ctx = await requireAdminContext("manage:support_tickets");
  const db = getAdminDb();

  await db
    .from("support_tickets")
    .update({ assigned_admin_id: assignedAdminId, updated_at: new Date().toISOString() })
    .eq("id", ticketId);

  await writeAdminAuditEvent({
    actorAdminId: ctx.adminUser.id,
    actorRole: ctx.roles[0] ?? "support_manager",
    action: "assign_support_ticket",
    targetType: "support_ticket",
    targetId: ticketId,
    reason: reason ?? "Ticket assignment",
    metadata: { assignedAdminId },
  });
}
