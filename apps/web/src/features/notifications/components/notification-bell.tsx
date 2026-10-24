"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format";
import {
  loadNotificationBell,
  markAllReadAction,
  markReadAction,
  type NotificationBellData,
} from "@/features/notifications/api/notifications";

/**
 * Notification bell (Phase 11c). Server-rendered with the initial unread count
 * (passed from the layout so first paint shows the badge); refreshes the list +
 * count from the server action on open. Clicking an item marks it read and
 * navigates to the entity (invoice/quote detail). "Mark all read" clears the
 * badge. No polling - adequate for this scale; `router.refresh()` updates the
 * count after a mark.
 */
type RecentItem = NotificationBellData["recent"][number];

function entityHref(item: RecentItem): string | null {
  if (!item.entityType || !item.entityId) return null;
  if (item.entityType === "invoice") return `/invoices/${item.entityId}`;
  if (item.entityType === "quote") return `/quotes/${item.entityId}`;
  return null;
}

export function NotificationBell({ initialUnreadCount }: { initialUnreadCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationBellData | null>(null);
  const [loading, setLoading] = useState(false);
  const unread = data?.unreadCount ?? initialUnreadCount;

  async function onOpenChange(next: boolean): Promise<void> {
    setOpen(next);
    if (next && !data && !loading) {
      setLoading(true);
      try {
        setData(await loadNotificationBell());
      } finally {
        setLoading(false);
      }
    }
  }

  async function onItemClick(item: RecentItem): Promise<void> {
    setOpen(false);
    // Mark read (best-effort) then navigate.
    if (!item.readAt) {
      try {
        await markReadAction(item.id);
      } catch {
        // non-fatal - still navigate
      }
      router.refresh();
    }
    const href = entityHref(item);
    if (href) router.push(href);
  }

  async function markAll(): Promise<void> {
    try {
      await markAllReadAction();
      router.refresh();
      setData((d) =>
        d
          ? {
              ...d,
              unreadCount: 0,
              recent: d.recent.map((n) => ({ ...n, readAt: n.readAt ?? new Date() })),
            }
          : d,
      );
    } catch {
      // non-fatal
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={(o) => void onOpenChange(o)}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="size-5" aria-hidden />
          {unread > 0 ? (
            <span
              className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold leading-none text-destructive-foreground tabular-nums"
              aria-label={`${unread} unread`}
            >
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0 text-sm font-medium">Notifications</DropdownMenuLabel>
          {unread > 0 ? (
            <button
              type="button"
              onClick={() => void markAll()}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Mark all read
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {loading && !data ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</div>
        ) : data && data.recent.length > 0 ? (
          data.recent.map((item) => {
            const href = entityHref(item);
            const content = (
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-sm ${item.readAt ? "text-muted-foreground" : "font-medium"}`}
                >
                  {item.title}
                </p>
                {item.body ? (
                  <p className="truncate text-xs text-muted-foreground">{item.body}</p>
                ) : null}
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {formatRelativeTime(item.createdAt)}
                </p>
              </div>
            );
            return (
              <DropdownMenuItem
                key={item.id}
                onSelect={() => void onItemClick(item)}
                className="gap-2 py-2"
              >
                {!item.readAt ? (
                  <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden />
                ) : (
                  <span className="size-1.5 shrink-0" aria-hidden />
                )}
                {href ? (
                  <Link
                    href={href}
                    className="flex min-w-0 flex-1 items-center gap-2"
                    onClick={(e) => e.preventDefault()}
                  >
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </DropdownMenuItem>
            );
          })
        ) : (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No notifications yet.
          </div>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/notifications" className="justify-center text-sm">
            View all
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
