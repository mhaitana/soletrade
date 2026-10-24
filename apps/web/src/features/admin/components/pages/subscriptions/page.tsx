import "server-only";
import * as React from "react";
import { CreditCard } from "lucide-react";
import { requireAdminContext } from "@/server/application/auth/admin-context";
import { listWorkspaceSubscriptions } from "@/server/application/admin/services/admin-subscriptions";
import {
  AdminPageHeader,
  StatusBadge,
  AdminTable,
  AdminTh,
  AdminTd,
  AdminTr,
  EmptyRow,
  Mono,
} from "@/features/admin/components/admin-ui";
import { ReconcileDialog } from "@/features/admin/components/subscriptions/reconcile-dialog";

export default async function AdminSubscriptionsPage() {
  await requireAdminContext("view:subscriptions");
  const subscriptions = await listWorkspaceSubscriptions();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={CreditCard}
        title="Subscription & Billing Administration"
        subtitle="Monitor Stripe-reconciled subscriptions across all tenant workspaces (Principle #6 & #11)."
      />

      <AdminTable caption="Workspace subscriptions">
        <thead>
          <tr>
            <AdminTh>Workspace ID</AdminTh>
            <AdminTh>Stripe Customer</AdminTh>
            <AdminTh>Stripe Sub ID</AdminTh>
            <AdminTh>Anchor Module</AdminTh>
            <AdminTh>Interval</AdminTh>
            <AdminTh>Period Ends</AdminTh>
            <AdminTh>Cancels at End</AdminTh>
            <AdminTh>Status</AdminTh>
            <AdminTh className="text-right">Actions</AdminTh>
          </tr>
        </thead>
        <tbody>
          {subscriptions.length === 0 ? (
            <EmptyRow colSpan={9}>No active Stripe subscriptions found.</EmptyRow>
          ) : (
            subscriptions.map((sub) => (
              <AdminTr key={sub.workspaceId}>
                <AdminTd>
                  <Mono className="text-foreground">{sub.workspaceId}</Mono>
                </AdminTd>
                <AdminTd>
                  <Mono className="text-muted-foreground">{sub.stripeCustomerId ?? "—"}</Mono>
                </AdminTd>
                <AdminTd>
                  <Mono className="text-muted-foreground">{sub.stripeSubscriptionId ?? "—"}</Mono>
                </AdminTd>
                <AdminTd className="font-medium text-foreground">
                  {sub.anchorModuleKey ?? "None"}
                </AdminTd>
                <AdminTd className="capitalize text-muted-foreground">
                  {sub.billingInterval ?? "—"}
                </AdminTd>
                <AdminTd className="tabular-nums text-muted-foreground">
                  {sub.currentPeriodEnd ? sub.currentPeriodEnd.toLocaleDateString() : "—"}
                </AdminTd>
                <AdminTd>
                  {sub.cancelAtPeriodEnd ? (
                    <span className="font-medium text-warning">Yes</span>
                  ) : (
                    <span className="text-muted-foreground">No</span>
                  )}
                </AdminTd>
                <AdminTd>
                  <StatusBadge status={sub.status} />
                </AdminTd>
                <AdminTd className="text-right">
                  <ReconcileDialog
                    workspaceId={sub.workspaceId}
                    stripeSubscriptionId={sub.stripeSubscriptionId}
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
