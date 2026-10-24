import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ModuleNotInstalledCard } from "@/components/module-not-installed-card";
import { ListPagination } from "@/components/list-pagination";
import { formatDate } from "@/utils/format-date";
import { formatCents } from "@/lib/domain/billing/pricing";
import { categoryLabel } from "@/config/books-categories";
import { loadReceiptsPage } from "@/features/books/api/receipts/actions";
import { ReceiptReviewCard } from "@/features/books/components/receipts/receipt-review-card";
import { ResponsiveFilter } from "@/components/ui/responsive-filter";
import { pageHref, parsePage } from "@/utils/pagination";

export const metadata = { title: "Receipts" };

type StatusFilter = "pending" | "reviewed" | "applied" | "rejected";

const STATUS_FILTERS: { key: "all" | StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "reviewed", label: "Reviewed" },
  { key: "applied", label: "Applied" },
  { key: "rejected", label: "Rejected" },
];

const STATUS_BADGE: Record<
  StatusFilter,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  pending: { label: "Pending", variant: "secondary" },
  reviewed: { label: "Reviewed", variant: "default" },
  applied: { label: "Applied", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
};

function hrefWith(patch: { status?: "all" | StatusFilter }): string {
  const next = patch.status ?? "all";
  if (next === "all") return "/books/receipts";
  return `/books/receipts?status=${next}`;
}

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; page?: string | string[] }>;
}) {
  const sp = await searchParams;
  const rawStatus = typeof sp.status === "string" ? sp.status : undefined;
  const status =
    rawStatus === "pending" ||
    rawStatus === "reviewed" ||
    rawStatus === "applied" ||
    rawStatus === "rejected"
      ? (rawStatus as StatusFilter)
      : undefined;
  const data = await loadReceiptsPage({ status, page: parsePage(sp.page) });

  if (!data.installed) return <ModuleNotInstalledCard moduleKey="books" />;

  if (!data.canManage) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Receipts</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to review receipts. Ask a workspace admin.
        </p>
      </div>
    );
  }

  const statusFilterItems = STATUS_FILTERS.map((filter) => ({
    key: filter.key,
    label: filter.label,
    href: hrefWith({ status: filter.key }),
    active: (filter.key === "all" && !data.statusFilter) || filter.key === data.statusFilter,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Receipts</h1>
        <p className="text-sm text-muted-foreground">
          Review extracted receipts and apply them as transactions.
        </p>
      </div>

      <ResponsiveFilter label="Filter extractions by status" items={statusFilterItems} />

      {data.extractions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {data.page > 1
              ? "No receipts on this page."
              : data.statusFilter
                ? `No ${data.statusFilter} receipts.`
                : "No receipts extracted yet. Upload a receipt on a transaction to start."}
          </p>
          {data.page > 1 ? (
            <p className="mt-1 text-sm">
              <Link
                href={pageHref("/books/receipts", 1, { status: data.statusFilter })}
                className="text-brand-blue hover:underline"
              >
                Return to first page
              </Link>
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {data.extractions.map((ext) => {
            const badge = STATUS_BADGE[ext.status];
            const reviewable = ext.status === "pending" || ext.status === "reviewed";
            const extracted = ext.extractedData;
            const label = extracted
              ? (categoryLabel("expense", extracted.category) ?? extracted.category)
              : null;
            return (
              <div key={ext.id} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    <span>{formatDate(ext.createdAt)}</span>
                    {extracted ? (
                      <span className="tabular-nums">
                        {formatCents(extracted.totalCents, extracted.currency)}
                      </span>
                    ) : null}
                    {label ? <span>· {label}</span> : null}
                  </div>
                  {ext.status === "applied" && ext.transactionId ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/books/${ext.transactionId}`}>View transaction</Link>
                    </Button>
                  ) : null}
                </div>
                {reviewable ? <ReceiptReviewCard extraction={ext} /> : null}
              </div>
            );
          })}
        </div>
      )}
      <ListPagination
        pathname="/books/receipts"
        page={data.page}
        hasNext={data.hasNext}
        filters={{ status: data.statusFilter }}
      />
    </div>
  );
}
