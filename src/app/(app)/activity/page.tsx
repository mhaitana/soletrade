import Link from "next/link";
import { loadActivityPage } from "./actions";
import { ActivityFeed } from "./activity-feed";
import { branded } from "@/shared/types/ids";
import type { ActivityCursor } from "@/platform/activity";
import { Button } from "@/shared/ui/button";

export const metadata = { title: "Activity" };

/**
 * Category filters map a human label to a set of event types. The `type` query
 * param carries the category key; the actual type list is resolved here, never
 * on the client.
 */
const CATEGORY_FILTERS: Record<string, { label: string; types: string[] }> = {
  all: { label: "All activity", types: [] },
  customers: {
    label: "Customers",
    types: ["CustomerCreated", "CustomerUpdated", "CustomerDeleted"],
  },
  members: { label: "Members", types: ["MemberInvited", "MemberAdded"] },
  modules: { label: "Modules", types: ["ModuleEnabled", "ModuleDisabled", "ModuleCancelled"] },
  billing: { label: "Billing", types: ["SubscriptionChanged", "CreditIssued", "RefundIssued"] },
  quotes: {
    label: "Quotes",
    types: [
      "QuoteSent",
      "QuoteViewed",
      "QuoteAccepted",
      "QuoteDeclined",
      "QuoteConvertedToInvoice",
    ],
  },
  invoices: {
    label: "Invoices",
    types: ["InvoiceSent", "InvoiceViewed", "InvoicePaid", "InvoiceOverdue"],
  },
};

const DEFAULT_LIMIT = 25;

const ALL_CATEGORY = { label: "All activity", types: [] as string[] };

/** Cursor is encoded as `<isoCreatedAt>|<id>` so it survives a GET round-trip.
 *  `createdAt` is the raw µs-precision ISO string (never a Date) so the keyset
 *  comparison stays exact - see `ActivityCursor`. */
function encodeCursor(cursor: ActivityCursor): string {
  return `${cursor.createdAt}|${cursor.id}`;
}

function parseCursor(raw: string): ActivityCursor | null {
  const [iso, id] = raw.split("|");
  if (!iso || !id) return null;
  return { createdAt: iso, id: branded<"ActivityEventId">(id) };
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string | string[]; before?: string | string[] }>;
}) {
  const sp = await searchParams;
  const categoryKey = typeof sp.type === "string" ? sp.type : "all";
  const category = CATEGORY_FILTERS[categoryKey] ?? ALL_CATEGORY;
  const beforeRaw = typeof sp.before === "string" ? sp.before : undefined;
  const before = beforeRaw ? (parseCursor(beforeRaw) ?? undefined) : undefined;

  const { items, nextCursor } = await loadActivityPage({
    types: category.types.length > 0 ? category.types : undefined,
    limit: DEFAULT_LIMIT,
    before,
  });

  const loadMoreHref = nextCursor
    ? `/activity?type=${categoryKey}&before=${encodeCursor(nextCursor)}`
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">
          A timeline of what&apos;s happening in this workspace.
        </p>
      </div>

      <form
        action="/activity"
        method="get"
        className="flex flex-wrap items-center gap-2"
        role="search"
      >
        <label htmlFor="activity-filter" className="sr-only">
          Filter activity by category
        </label>
        <select
          id="activity-filter"
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
            <Link href="/activity">Clear</Link>
          </Button>
        ) : null}
      </form>

      <ActivityFeed items={items} />

      {loadMoreHref ? (
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link href={loadMoreHref}>Load more</Link>
          </Button>
        </div>
      ) : items.length > 0 ? (
        <p className="text-center text-xs text-muted-foreground">End of activity.</p>
      ) : null}
    </div>
  );
}
