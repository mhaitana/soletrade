import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { formatCents } from "@/platform/billing/pricing";
import { formatDate } from "@/shared/utils/format-date";
import { categoryLabel } from "@/shared/constants/books-categories";
import { loadTransaction } from "../actions";
import { BookDetailActions } from "../book-detail-actions";
import type { BookType } from "@/server/db/schema/enums";

export const metadata = { title: "Transaction" };

const TYPE_BADGE: Record<BookType, { label: string; variant: "default" | "destructive" }> = {
  income: { label: "Income", variant: "default" },
  expense: { label: "Expense", variant: "destructive" },
};

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadTransaction(id);
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="books" />;
  if (!data.transaction) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Transaction not found.</p>
        <Button asChild variant="outline">
          <Link href="/books">Back to books</Link>
        </Button>
      </div>
    );
  }

  const tx = data.transaction;
  const badge = TYPE_BADGE[tx.type];
  const label = categoryLabel(tx.type, tx.category);
  const signed = tx.type === "income" ? tx.amountCents : -tx.amountCents;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{tx.description}</h1>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {tx.customerName ? (
              <Link href="/customers" className="hover:underline">
                {tx.customerName}
              </Link>
            ) : (
              "No customer"
            )}
          </p>
        </div>
        {data.canManage ? <BookDetailActions txId={tx.id} /> : null}
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Date</dt>
          <dd className="text-sm">{formatDate(tx.date)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Amount</dt>
          <dd className="text-sm tabular-nums">{formatCents(signed, tx.currency)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Category</dt>
          <dd className="text-sm">{label ?? tx.category}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Currency</dt>
          <dd className="text-sm">{tx.currency}</dd>
        </div>
      </dl>

      {tx.notes ? (
        <div className="rounded-md border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Notes</p>
          <p className="mt-1 text-sm whitespace-pre-wrap">{tx.notes}</p>
        </div>
      ) : null}
    </div>
  );
}
