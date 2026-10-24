import "server-only";
import * as React from "react";
import { Webhook } from "lucide-react";
import { requireAdminContext } from "@/server/application/auth/admin-context";
import { listWebhookEvents } from "@/server/application/admin/services/admin-operations";
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
import { RetryWebhookDialog } from "@/features/admin/components/webhooks/retry-webhook-dialog";

export default async function AdminWebhooksPage() {
  await requireAdminContext("view:operations");
  const events = await listWebhookEvents();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Webhook}
        title="Webhook Event Inspector"
        subtitle="Monitor inbound provider notifications and trigger idempotent retries."
      />

      <AdminTable caption="Webhook events">
        <thead>
          <tr>
            <AdminTh>Received At</AdminTh>
            <AdminTh>Provider</AdminTh>
            <AdminTh>Event ID</AdminTh>
            <AdminTh>Event Type</AdminTh>
            <AdminTh>Attempts</AdminTh>
            <AdminTh>Status</AdminTh>
            <AdminTh className="text-right">Actions</AdminTh>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 ? (
            <EmptyRow colSpan={7}>No webhook events recorded.</EmptyRow>
          ) : (
            events.map((evt) => (
              <AdminTr key={evt.id}>
                <AdminTd className="text-muted-foreground">
                  {evt.createdAt.toLocaleString()}
                </AdminTd>
                <AdminTd className="font-semibold uppercase text-foreground">
                  {evt.provider}
                </AdminTd>
                <AdminTd>
                  <Mono className="text-muted-foreground">{evt.eventId}</Mono>
                </AdminTd>
                <AdminTd>
                  <Mono className="text-foreground">{evt.eventType}</Mono>
                </AdminTd>
                <AdminTd className="tabular-nums text-muted-foreground">{evt.attempts}</AdminTd>
                <AdminTd>
                  <StatusBadge status={evt.status} />
                </AdminTd>
                <AdminTd className="text-right">
                  <RetryWebhookDialog webhookId={evt.id} eventType={evt.eventType} />
                </AdminTd>
              </AdminTr>
            ))
          )}
        </tbody>
      </AdminTable>
    </div>
  );
}
