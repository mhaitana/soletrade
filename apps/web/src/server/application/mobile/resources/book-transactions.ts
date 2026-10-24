import "server-only";
import * as books from "@/server/domains/books";
import type { Context } from "./common";

export async function allTransactions(
  ctx: Context,
  opts: { dateFrom?: Date; dateTo?: Date; type?: "income" | "expense" } = {},
) {
  const rows: books.TransactionRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const batch = await books.listTransactions(ctx.workspaceId, { ...opts, offset, limit: 500 });
    rows.push(...batch);
    if (batch.length < 500) return rows;
  }
}
