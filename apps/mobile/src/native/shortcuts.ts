import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as QuickActions from "expo-quick-actions";
import type { MobileModule } from "@soletrade/contracts";
import { SHORTCUT_TARGETS, shortcutTarget } from "./shortcut-policy";
export async function clearAppShortcuts() {
  await QuickActions.setItems([]);
}
export function useAppShortcuts({
  userId,
  workspaceId,
  modules,
  open,
}: {
  userId: string;
  workspaceId: string;
  modules: MobileModule[];
  open: (href: string) => void;
}) {
  const handledInitial = useRef(false);
  useEffect(() => {
    let live = true;
    const binding = { userId, workspaceId };
    if (!userId || !workspaceId) {
      void clearAppShortcuts().catch(() => undefined);
      return;
    }
    const handle = (action: QuickActions.Action) => {
      if (!live) return;
      const href = shortcutTarget(action, binding, modules);
      if (href) open(href);
    };
    const subscription = QuickActions.addListener(handle);
    if (!handledInitial.current && QuickActions.initial) {
      const target = shortcutTarget(QuickActions.initial, binding, modules);
      if (target) {
        handledInitial.current = true;
        open(target);
      }
    }
    void QuickActions.isSupported()
      .then((supported) => {
        if (!live) return;
        if (!supported) return clearAppShortcuts();
        return QuickActions.setItems(
          SHORTCUT_TARGETS.filter((item) => modules.includes(item.module)).map((item) => ({
            id: item.id,
            title: item.title,
            ...(Platform.OS === "ios" ? { icon: item.icon } : {}),
            params: { href: item.href, userId, workspaceId },
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      live = false;
      subscription.remove();
    };
  }, [userId, workspaceId, modules, open]);
}
