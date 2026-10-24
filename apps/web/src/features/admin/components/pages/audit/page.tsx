import "server-only";
import * as React from "react";
import { FileText } from "lucide-react";
import { requireAdminContext } from "@/server/application/auth/admin-context";
import { listAdminAuditEvents } from "@/server/application/admin/services/admin-audit";
import {
  AdminPageHeader,
  AdminTable,
  AdminTh,
  AdminTd,
  AdminTr,
  EmptyRow,
  Mono,
} from "@/features/admin/components/admin-ui";

export default async function AdminAuditLogPage() {
  await requireAdminContext("view:audit_logs");
  const events = await listAdminAuditEvents({ limit: 100 });

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={FileText}
        title="Immutable Admin Audit Log"
        subtitle="Tamper-evident operational trail of all administrative actions (Principle #2 & #5)."
      />

      <AdminTable caption="Admin audit events">
        <thead>
          <tr>
            <AdminTh>Timestamp</AdminTh>
            <AdminTh>Actor Admin ID</AdminTh>
            <AdminTh>Role</AdminTh>
            <AdminTh>Action</AdminTh>
            <AdminTh>Target</AdminTh>
            <AdminTh>Reason</AdminTh>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 ? (
            <EmptyRow colSpan={6}>No administrative events recorded yet.</EmptyRow>
          ) : (
            events.map((evt) => (
              <AdminTr key={evt.id}>
                <AdminTd>
                  <Mono className="text-muted-foreground">{evt.createdAt.toLocaleString()}</Mono>
                </AdminTd>
                <AdminTd>
                  <Mono className="max-w-[140px] truncate text-foreground" title={evt.actorAdminId}>
                    {evt.actorAdminId}
                  </Mono>
                </AdminTd>
                <AdminTd>
                  <Mono className="text-[10px] uppercase text-brand-blue">
                    {evt.actorRole.replace("_", " ")}
                  </Mono>
                </AdminTd>
                <AdminTd className="font-semibold text-foreground">{evt.action}</AdminTd>
                <AdminTd>
                  <Mono className="text-muted-foreground">
                    {evt.targetType}: {evt.targetId}
                  </Mono>
                </AdminTd>
                <AdminTd className="text-muted-foreground">{evt.reason ?? "—"}</AdminTd>
              </AdminTr>
            ))
          )}
        </tbody>
      </AdminTable>
    </div>
  );
}
