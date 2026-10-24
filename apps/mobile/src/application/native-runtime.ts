import { registerPush } from "@/lib/native/device";
import { observeOperationalHealth } from "@/lib/native/operational-health";
import { reconcileRouteDeletions, recoverShift } from "@/lib/native/shift";
import { readState, recoverCapturedFiles, syncOutbox } from "@/lib/offline/store";
import type { MobileFeatureProps } from "@soletrade/contracts";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { AppState } from "react-native";
/** Retry already-saved operations in the foreground. This never queues an unsaved draft. */
export function useNativeRuntime({ userId, workspaceId, request }: MobileFeatureProps) {
  useEffect(() => {
    if (!userId || !workspaceId) return;
    let live = true,
      running = false;
    const binding = { userId, workspaceId };
    const retry = async () => {
      if (!live || running || AppState.currentState !== "active") return;
      running = true;
      try {
        await recoverCapturedFiles(binding).catch(() => undefined);
        await recoverShift(binding).catch(() => undefined);
        if (live) await syncOutbox(binding, request);
      } catch {
        /* Access failures remain visible on each durable draft. */
      } finally {
        if (live) void observeOperationalHealth(binding, request);
        running = false;
      }
    };
    const activate = async () => {
      await retry();
      if (!live) return;
      await reconcileRouteDeletions(binding, request).catch(() => undefined);
      const registered = await readState<string>(`push-device:${userId}`);
      if (live && registered && (await Notifications.getPermissionsAsync()).granted)
        await registerPush(request, userId).catch(() => undefined);
    };
    void activate();
    const timer = setInterval(() => void retry(), 30000);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void activate();
    });
    return () => {
      live = false;
      clearInterval(timer);
      listener.remove();
    };
  }, [userId, workspaceId, request]);
}
