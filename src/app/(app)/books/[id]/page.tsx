import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { formatCents } from "@/platform/billing/pricing";
import { formatDate } from "@/shared/utils/format-date";
import { categoryLabel } from "@/shared/constants/books-categories";
import { loadTransaction } from "../actions";
import { BookDetailActions } from "../book-detail-actions";
import { ReceiptLink } from "./receipt-link";
import type { BookType } from "@/server/db/enums";

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
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="w-full max-w-full break-words text-2xl font-semibold tracking-tight sm:w-auto">
              {tx.description}
            </h1>
            <Badge variant={badge.variant}>{badge.label}</Badge>
            {data.source ? (
              <Badge asChild variant="outline">
                <Link href={data.source.href}>Synced from {data.source.label}</Link>
              </Badge>
            ) : null}
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

      {data.source ? (
        <div className="rounded-md border border-brand-blue/20 bg-brand-blue/5 p-4 text-sm">
          This entry stays in sync with its {data.source.label.toLowerCase()}. To change it, edit
          the record in {data.source.module === "invoices" ? "Invoices" : "Drive"}.
          <Link
            href={data.source.href}
            className="ml-1 font-medium text-brand-blue hover:underline"
          >
            Open source
          </Link>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Date</dt>
          <dd className="text-sm">{formatDate(tx.date)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Amount</dt>
          <dd className="font-mono text-sm tabular-nums">{formatCents(signed, tx.currency)}</dd>
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

      {tx.receiptFileId ? (
        <div className="rounded-md border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Receipt</p>
          <div className="mt-2">
            <ReceiptLink fileId={tx.receiptFileId} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
