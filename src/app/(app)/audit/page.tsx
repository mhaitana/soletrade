import Link from "next/link";
import { loadAuditPage } from "./actions";
import { AuditFeed } from "./audit-feed";
import { branded } from "@/shared/types/ids";
import type { AuditCursor } from "@/platform/audit";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";

export const metadata = { title: "Audit log" };

/**
 * Category filters map a human label to an audit action prefix. Audit actions are
 * dotted (`member.remove`, `billing.subscription.update`, …) so a prefix filter
 * is the natural grouping. The `type` query param carries the category key.
 */
const CATEGORY_FILTERS: Record<string, { label: string; prefix?: string }> = {
  all: { label: "All entries" },
  members: { label: "Members", prefix: "member." },
  modules: { label: "Modules", prefix: "module." },
  billing: { label: "Billing", prefix: "billing." },
  credits: { label: "Credits", prefix: "credit." },
  invoices: { label: "Invoices", prefix: "invoice." },
  quotes: { label: "Quotes", prefix: "quote." },
  transactions: { label: "Transactions", prefix: "transaction." },
  drive: { label: "Drive", prefix: "drive." },
};

const DEFAULT_LIMIT = 25;
const ALL_CATEGORY: { label: string; prefix?: string } = { label: "All entries" };

/** Cursor is encoded as `<isoCreatedAt>|<id>` so it survives a GET round-trip.
 *  `createdAt` is the raw µs-precision ISO string (never a Date) so the keyset
 *  comparison stays exact — see `AuditCursor`. */
function encodeCursor(cursor: AuditCursor): string {
  return `${cursor.createdAt}|${cursor.id}`;
}

function parseCursor(raw: string): AuditCursor | null {
  const [iso, id] = raw.split("|");
  if (!iso || !id) return null;
  return { createdAt: iso, id: branded<"AuditLogId">(id) };
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string | string[]; before?: string | string[] }>;
}) {
  const sp = await searchParams;
  const categoryKey = typeof sp.type === "string" ? sp.type : "all";
  const category = CATEGORY_FILTERS[categoryKey] ?? ALL_CATEGORY;
  const beforeRaw = typeof sp.before === "string" ? sp.before : undefined;
  const before = beforeRaw ? (parseCursor(beforeRaw) ?? undefined) : undefined;

  const result = await loadAuditPage({
    actionPrefix: category.prefix,
    limit: DEFAULT_LIMIT,
    before,
  });

  if (!result.access) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
          <p className="text-sm text-muted-foreground">
            An append-only record of sensitive workspace mutations.
          </p>
        </div>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">
              You don&apos;t have permission to view the audit log. Owners, admins, and accountants
              can access it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { items, nextCursor } = result.page;
  const loadMoreHref = nextCursor
    ? `/audit?type=${categoryKey}&before=${encodeCursor(nextCursor)}`
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          An append-only record of sensitive workspace mutations (billing, members, modules, and
          per-module changes).
        </p>
      </div>

      <form
        action="/audit"
        method="get"
        className="flex flex-wrap items-center gap-2"
        role="search"
      >
        <label htmlFor="audit-filter" className="sr-only">
          Filter audit entries by category
        </label>
        <select
          id="audit-filter"
          name="type"
          defaultValue={categoryKey}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {Object.entries(CATEGORY_FILTERS).map(([key, { label }]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Apply
        </Button>
        {categoryKey !== "all" ? (
          <Button asChild variant="ghost">
            <Link href="/audit">Clear</Link>
          </Button>
        ) : null}
      </form>

      <AuditFeed items={items} />

      {loadMoreHref ? (
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link href={loadMoreHref}>Load more</Link>
          </Button>
        </div>
      ) : items.length > 0 ? (
        <p className="text-center text-xs text-muted-foreground">End of audit log.</p>
      ) : null}
    </div>
  );
}
