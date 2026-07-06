import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Mail, Phone, Building2, Pencil } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { CustomerTimeline } from "@/shared/components/customer-timeline/customer-timeline";
import { ActivityFeed } from "../../activity/activity-feed";
import { loadCustomerTimeline } from "./actions";
import { formatDate } from "@/shared/utils/format-date";

export const metadata = { title: "Customer" };

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadCustomerTimeline(id);
  if (!data.found) notFound();

  const { customer, canManage, timeline, activity } = data;

  return (
    <div className="space-y-6">
      <Link
        href="/customers"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Back to customers
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{customer.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {customer.email ? (
              <span className="inline-flex items-center gap-1">
                <Mail className="size-3.5" aria-hidden />
                {customer.email}
              </span>
            ) : null}
            {customer.phone ? (
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3.5" aria-hidden />
                {customer.phone}
              </span>
            ) : null}
            {customer.company ? (
              <span className="inline-flex items-center gap-1">
                <Building2 className="size-3.5" aria-hidden />
                {customer.company}
              </span>
            ) : null}
          </div>
          {customer.notes ? (
            <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
              {customer.notes}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">
            Added {formatDate(customer.createdAt)}
          </p>
        </div>
        {canManage ? (
          <Button asChild variant="outline">
            <Link href={`/customers/${customer.id}/edit`}>
              <Pencil className="size-4" aria-hidden />
              Edit
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2 space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Timeline</h2>
          <CustomerTimeline entries={timeline} />
        </section>

        <aside className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Activity</h2>
          <ActivityFeed items={activity} />
        </aside>
      </div>
    </div>
  );
}
