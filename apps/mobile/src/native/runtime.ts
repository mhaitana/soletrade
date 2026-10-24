import { useEffect } from "react";
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import type { MobileFeatureProps } from "@soletrade/contracts";
import { readState, recoverCapturedFiles, syncOutbox } from "../offline/store";
import { reconcileRouteDeletions, recoverShift } from "./shift";
import { registerPush } from "./device";
import { observeOperationalHealth } from "../lib/operational-health";
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
