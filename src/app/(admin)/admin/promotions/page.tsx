import "server-only";
import * as React from "react";
import { Tag } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { listPromotions } from "@/platform/admin/services/admin-promotions";
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
import { CreatePromotionDialog } from "./create-promotion-dialog";
import { SyncPromotionDialog } from "./sync-promotion-dialog";
import { ArchivePromotionDialog } from "./archive-promotion-dialog";

export default async function AdminPromotionsPage() {
  await requireAdminContext("view:subscriptions");
  const promotions = await listPromotions();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Tag}
        title="Promotions & Coupons Management"
        subtitle="Stripe-backed discounts and coupon campaigns (Principle #7)."
        action={<CreatePromotionDialog />}
      />

      <AdminTable caption="Promotions">
        <thead>
          <tr>
            <AdminTh>Promotion Name</AdminTh>
            <AdminTh>Public Code</AdminTh>
            <AdminTh>Discount</AdminTh>
            <AdminTh>Duration</AdminTh>
            <AdminTh className="text-right">Redemptions</AdminTh>
            <AdminTh>Last Synced</AdminTh>
            <AdminTh>Status</AdminTh>
            <AdminTh className="text-right">Actions</AdminTh>
          </tr>
        </thead>
        <tbody>
          {promotions.length === 0 ? (
            <EmptyRow colSpan={8}>No promotional campaigns created yet.</EmptyRow>
          ) : (
            promotions.map((p) => {
              const live = p.active && p.stripeCouponActive;
              return (
                <AdminTr key={p.id}>
                  <AdminTd className="font-medium text-foreground">{p.name}</AdminTd>
                  <AdminTd>
                    <Mono className="text-foreground">{p.publicCode ?? "—"}</Mono>
                  </AdminTd>
                  <AdminTd className="tabular-nums text-foreground">
                    {p.discountType === "percentage"
                      ? `${p.percentOff}% off`
                      : `$${((p.amountOffCents ?? 0) / 100).toFixed(2)} off`}
                  </AdminTd>
                  <AdminTd className="capitalize text-muted-foreground">{p.duration}</AdminTd>
                  <AdminTd className="text-right">
                    <Mono className="tabular-nums text-foreground">{p.timesRedeemed}</Mono>
                  </AdminTd>
                  <AdminTd className="text-muted-foreground">
                    {p.lastSyncedAt ? p.lastSyncedAt.toLocaleString() : "—"}
                  </AdminTd>
                  <AdminTd>
                    <StatusBadge status={live ? "active" : "archived"} />
                  </AdminTd>
                  <AdminTd className="text-right">
                    <div className="flex justify-end gap-2">
                      <SyncPromotionDialog promotionId={p.id} />
                      {live ? (
                        <ArchivePromotionDialog promotionId={p.id} promotionName={p.name} />
                      ) : null}
                    </div>
                  </AdminTd>
                </AdminTr>
              );
            })
          )}
        </tbody>
      </AdminTable>
    </div>
  );
}
