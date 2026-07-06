"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { formatRelativeTime } from "@/shared/lib/format";
import { markAllReadAction, markReadAction } from "../actions/notifications";
import type { NotificationRow } from "@/platform/notifications/store";

/**
 * Notifications list (Phase 11c). Each row shows the title, body, and relative
 * time; unread rows get a dot + bold title. Clicking a row marks it read and
 * navigates to the entity (invoice/quote detail) when the notification has a
 * linkable entity. "Mark all read" clears the badge across the page.
 */
function entityHref(row: NotificationRow): string | null {
  if (!row.entityType || !row.entityId) return null;
  if (row.entityType === "invoice") return `/invoices/${row.entityId}`;
  if (row.entityType === "quote") return `/quotes/${row.entityId}`;
  return null;
}

export function NotificationsList({ items }: { items: NotificationRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  function open(row: NotificationRow): void {
    if (!row.readAt) {
      setBusyId(row.id);
      startTransition(async () => {
        try {
          await markReadAction(row.id);
        } catch {
          // non-fatal
        }
        router.refresh();
      });
    }
    const href = entityHref(row);
    if (href) router.push(href);
  }

  function markAll(): void {
    startTransition(async () => {
      try {
        await markAllReadAction();
        router.refresh();
      } catch {
        // non-fatal
      }
    });
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">No notifications.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Quote acceptances, payments, and overdue invoices will show up here.
        </p>
      </div>
    );
  }

  const hasUnread = items.some((i) => !i.readAt);

  return (
    <div className="space-y-3">
      {hasUnread ? (
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={markAll}>
            Mark all read
          </Button>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-border">
        <ul className="divide-y divide-border">
          {items.map((row) => {
            const href = entityHref(row);
            const unread = !row.readAt;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => open(row)}
                  disabled={busyId === row.id}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/40 disabled:opacity-60"
                >
                  {unread ? (
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-destructive"
                      aria-hidden
                    />
                  ) : (
                    <span className="mt-1.5 size-1.5 shrink-0" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${unread ? "font-medium" : "text-muted-foreground"}`}>
                      {row.title}
                    </p>
                    {row.body ? (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.body}</p>
                    ) : null}
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      <time dateTime={row.createdAt.toISOString()}>
                        {formatRelativeTime(row.createdAt)}
                      </time>
                      {href ? <span className="ml-1">· open →</span> : null}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
