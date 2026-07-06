import Link from "next/link";
import { loadNotificationsPage } from "../actions/notifications";
import { NotificationsList } from "./notifications-list";
import { branded } from "@/shared/types/ids";
import type { NotificationCursor } from "@/platform/notifications/store";
import { Button } from "@/shared/ui/button";

export const metadata = { title: "Notifications" };

const DEFAULT_LIMIT = 25;

/** Cursor is encoded as `<isoCreatedAt>|<id>` so it survives a GET round-trip. */
function encodeCursor(cursor: NotificationCursor): string {
  return `${cursor.createdAt.toISOString()}|${cursor.id}`;
}

function parseCursor(raw: string): NotificationCursor | null {
  const [iso, id] = raw.split("|");
  if (!iso || !id) return null;
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id: branded<"NotificationId">(id) };
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ unread?: string | string[]; before?: string | string[] }>;
}) {
  const sp = await searchParams;
  const unreadOnly = sp.unread === "1";
  const beforeRaw = typeof sp.before === "string" ? sp.before : undefined;
  const before = beforeRaw ? (parseCursor(beforeRaw) ?? undefined) : undefined;

  const { items, nextCursor } = await loadNotificationsPage({
    unreadOnly,
    limit: DEFAULT_LIMIT,
    before,
  });

  const loadMoreHref = nextCursor
    ? `/notifications?before=${encodeCursor(nextCursor)}${unreadOnly ? "&unread=1" : ""}`
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            Quote acceptances, payments, and overdue invoices in this workspace.
          </p>
        </div>
        <Button asChild variant={unreadOnly ? "default" : "outline"} size="sm">
          <Link href={unreadOnly ? "/notifications" : "/notifications?unread=1"}>
            {unreadOnly ? "Showing unread" : "Show unread only"}
          </Link>
        </Button>
      </div>

      <NotificationsList items={items} />

      {loadMoreHref ? (
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link href={loadMoreHref}>Load more</Link>
          </Button>
        </div>
      ) : items.length > 0 ? (
        <p className="text-center text-xs text-muted-foreground">End of notifications.</p>
      ) : null}
    </div>
  );
}
