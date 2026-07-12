import "server-only";
import * as React from "react";
import { KeyRound } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { getAdminDb } from "@/platform/admin/services/db";
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

export default async function AdminAccessRequestsPage() {
  await requireAdminContext("view:support_tickets");
  const db = getAdminDb();

  const [{ data: requests }, { data: sessions }] = await Promise.all([
    db
      .from("support_access_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("support_access_sessions")
      .select("*")
      .order("starts_at", { ascending: false })
      .limit(50),
  ]);

  const reqRows = (requests ?? []) as Array<{
    id: string;
    workspace_id: string;
    requested_by_admin_id: string;
    scopes: string[];
    access_level: string;
    reason: string;
    status: string;
    created_at: string;
  }>;

  const sessRows = (sessions ?? []) as Array<{
    id: string;
    workspace_id: string;
    admin_user_id: string;
    scopes: string[];
    access_level: string;
    expires_at: string;
    status: string;
  }>;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={KeyRound}
        title="Temporary Customer-Approved Support Access"
        subtitle="Explicit, time-limited support sessions (Principle #3, #4 & #15). Customer content is strictly isolated outside approved sessions."
      />

      {/* Active & Approved Sessions */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Active Support Sessions</h2>
        <AdminTable caption="Active support access sessions">
          <thead>
            <tr>
              <AdminTh>Workspace ID</AdminTh>
              <AdminTh>Admin Staff</AdminTh>
              <AdminTh>Access Level</AdminTh>
              <AdminTh>Scopes</AdminTh>
              <AdminTh>Expires At</AdminTh>
              <AdminTh>Status</AdminTh>
            </tr>
          </thead>
          <tbody>
            {sessRows.length === 0 ? (
              <EmptyRow colSpan={6}>No active support sessions.</EmptyRow>
            ) : (
              sessRows.map((s) => (
                <AdminTr key={s.id}>
                  <AdminTd>
                    <Mono className="text-foreground">{s.workspace_id}</Mono>
                  </AdminTd>
                  <AdminTd>
                    <Mono className="text-muted-foreground">{s.admin_user_id}</Mono>
                  </AdminTd>
                  <AdminTd>
                    <StatusBadge status={s.access_level} />
                  </AdminTd>
                  <AdminTd className="text-muted-foreground">{s.scopes.join(", ")}</AdminTd>
                  <AdminTd>
                    <Mono className="text-muted-foreground">
                      {new Date(s.expires_at).toLocaleString()}
                    </Mono>
                  </AdminTd>
                  <AdminTd>
                    <StatusBadge status={s.status} />
                  </AdminTd>
                </AdminTr>
              ))
            )}
          </tbody>
        </AdminTable>
      </div>

      {/* Access Requests */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Recent Access Requests</h2>
        <AdminTable caption="Support access requests">
          <thead>
            <tr>
              <AdminTh>Requested At</AdminTh>
              <AdminTh>Workspace ID</AdminTh>
              <AdminTh>Reason</AdminTh>
              <AdminTh>Scopes</AdminTh>
              <AdminTh>Status</AdminTh>
            </tr>
          </thead>
          <tbody>
            {reqRows.length === 0 ? (
              <EmptyRow colSpan={5}>No support access requests found.</EmptyRow>
            ) : (
              reqRows.map((r) => (
                <AdminTr key={r.id}>
                  <AdminTd className="text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </AdminTd>
                  <AdminTd>
                    <Mono className="text-foreground">{r.workspace_id}</Mono>
                  </AdminTd>
                  <AdminTd className="text-muted-foreground">{r.reason}</AdminTd>
                  <AdminTd className="text-muted-foreground">{r.scopes.join(", ")}</AdminTd>
                  <AdminTd>
                    <StatusBadge status={r.status} />
                  </AdminTd>
                </AdminTr>
              ))
            )}
          </tbody>
        </AdminTable>
      </div>
    </div>
  );
}
