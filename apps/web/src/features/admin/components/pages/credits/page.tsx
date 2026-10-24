import "server-only";
import * as React from "react";
import { Coins } from "lucide-react";
import { requireAdminContext } from "@/server/application/auth/admin-context";
import { getAdminDb } from "@/server/foundation/identity/db";
import {
  AdminPageHeader,
  AdminTable,
  AdminTh,
  AdminTd,
  AdminTr,
  EmptyRow,
  Mono,
} from "@/features/admin/components/admin-ui";

export default async function AdminCreditsPage() {
  await requireAdminContext("view:credits");
  const db = getAdminDb();

  const { data: entries } = await db
    .from("billing_credit_ledger")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (entries ?? []) as Array<{
    id: string;
    workspace_id: string;
    amount_cents: number;
    currency: string;
    type: string;
    reason: string;
    created_at: string;
  }>;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Coins}
        title="Append-Only Credit Ledger"
        subtitle="Global immutable audit trail for workspace credit adjustments (Principle #7 & #12)."
      />

      <AdminTable caption="Credit ledger entries">
        <thead>
          <tr>
            <AdminTh>Timestamp</AdminTh>
            <AdminTh>Workspace ID</AdminTh>
            <AdminTh>Type</AdminTh>
            <AdminTh>Reason</AdminTh>
            <AdminTh className="text-right">Amount</AdminTh>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={5}>No ledger adjustments recorded yet.</EmptyRow>
          ) : (
            rows.map((entry) => (
              <AdminTr key={entry.id}>
                <AdminTd className="text-muted-foreground">
                  {new Date(entry.created_at).toLocaleString()}
                </AdminTd>
                <AdminTd>
                  <Mono className="text-foreground">{entry.workspace_id}</Mono>
                </AdminTd>
                <AdminTd>
                  <Mono className="text-[11px] uppercase text-brand-blue">{entry.type}</Mono>
                </AdminTd>
                <AdminTd className="text-muted-foreground">{entry.reason}</AdminTd>
                <AdminTd className="text-right">
                  <Mono
                    className={
                      entry.amount_cents >= 0
                        ? "font-semibold text-success"
                        : "font-semibold text-destructive"
                    }
                  >
                    {entry.amount_cents >= 0 ? "+" : ""}
                    {(entry.amount_cents / 100).toFixed(2)} {entry.currency}
                  </Mono>
                </AdminTd>
              </AdminTr>
            ))
          )}
        </tbody>
      </AdminTable>
    </div>
  );
}
