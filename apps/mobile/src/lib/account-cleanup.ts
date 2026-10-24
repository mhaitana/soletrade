import * as SecureStore from "expo-secure-store";
import { suspendShiftForLogout, discardPrivateDeviceData } from "@/native/shift";
import { purgeClosedAccountData } from "@/offline/store";
import { clearWidgets } from "@/native/widgets";
import { clearAppShortcuts } from "@/native/shortcuts";
import { supabase } from "./supabase";
/** Closure overrides draft-retention choices. Every cleanup runs before local auth is cleared. */
export async function purgeClosedAccountLocally(userId: string) {
  const steps = [
    () => suspendShiftForLogout(userId),
    () => purgeClosedAccountData(userId),
    () => discardPrivateDeviceData(userId),
    () => clearWidgets(),
    () => clearAppShortcuts(),
    () => SecureStore.deleteItemAsync(`lock.${userId}`),
    () => SecureStore.deleteItemAsync(`workspace.${userId}`),
  ];
  let cleanupError: unknown;
  try {
    for (const step of steps) {
      try {
        await step();
      } catch (cause) {
        cleanupError ??= cause;
      }
    }
  } finally {
    await supabase.auth.signOut({ scope: "local" });
  }
  if (cleanupError) throw cleanupError;
}
