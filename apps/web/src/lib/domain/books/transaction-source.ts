import type { TransactionRow, TransactionSource } from "./types";

export function transactionSource(
  transaction: Pick<
    TransactionRow,
    "sourceInvoiceId" | "sourceEarningId" | "sourceExpenseId" | "sourceTripId"
  >,
): TransactionSource | null {
  if (transaction.sourceInvoiceId) {
    return {
      module: "invoices",
      label: "Invoice",
      href: `/invoices/${transaction.sourceInvoiceId}`,
    };
  }
  if (transaction.sourceEarningId) {
    return { module: "drive", label: "Drive earning", href: "/drive" };
  }
  if (transaction.sourceExpenseId) {
    return { module: "drive", label: "Drive expense", href: "/drive/expenses" };
  }
  if (transaction.sourceTripId) {
    return { module: "drive", label: "Drive mileage", href: "/drive" };
  }
  return null;
}
