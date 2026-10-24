import { discardPrivateDeviceData, suspendShiftForLogout } from "@/lib/native/shift";
import { clearAppShortcuts } from "@/lib/native/shortcuts";
import { clearWidgets } from "@/lib/native/widgets";
import { purgeClosedAccountData } from "@/lib/offline/store";
import { supabase } from "@/lib/supabase";
import * as SecureStore from "expo-secure-store";
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
