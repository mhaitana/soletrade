"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceContext } from "@/platform/context";
import {
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
  type NotificationListOptions,
  type NotificationPage,
} from "@/platform/notifications/store";
import { branded } from "@/shared/types/ids";

/**
 * Server actions for the in-app notification center (Phase 11c). All scoping comes
 * from the session (`requireWorkspaceContext` resolves `workspaceId` + `user.id`)
 * — a client-provided id is never trusted. The store double-checks
 * `workspaceId AND userId` on every read/write (IDOR-safe across users AND
 * workspaces).
 */

export interface NotificationBellData {
  unreadCount: number;
  recent: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    entityType: string | null;
    entityId: string | null;
    readAt: Date | null;
    createdAt: Date;
  }[];
}

/**
 * Load the bell payload: unread count + the 8 most recent notifications. Called on
 * mount + focus from the `NotificationBell` client component. Scoped to the user.
 */
export async function loadNotificationBell(): Promise<NotificationBellData> {
  const ctx = await requireWorkspaceContext();
  const [count, recent] = await Promise.all([
    unreadCount(ctx.workspaceId, ctx.user.id),
    listNotifications(ctx.workspaceId, ctx.user.id, { limit: 8 }),
  ]);
  return {
    unreadCount: count,
    recent: recent.items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      entityType: n.entityType,
      entityId: n.entityId,
      readAt: n.readAt,
      createdAt: n.createdAt,
    })),
  };
}

export async function loadNotificationsPage(
  opts: NotificationListOptions = {},
): Promise<NotificationPage> {
  const ctx = await requireWorkspaceContext();
  return listNotifications(ctx.workspaceId, ctx.user.id, opts);
}

export async function markReadAction(notificationId: string): Promise<void> {
  const ctx = await requireWorkspaceContext();
  await markRead(ctx.workspaceId, ctx.user.id, branded<"NotificationId">(notificationId));
  revalidatePath("/notifications");
}

export async function markAllReadAction(): Promise<void> {
  const ctx = await requireWorkspaceContext();
  await markAllRead(ctx.workspaceId, ctx.user.id);
  revalidatePath("/notifications");
}
