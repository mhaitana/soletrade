import { Action } from "@/components/ui";
import { useSession } from "@/lib/session";
import { Alert } from "react-native";

export function SignOutButton() {
  const { signOut, userId, request } = useSession();
  const leave = async (disposition: "keep" | "discard") => {
    try {
      const [store, shift, device, widgets] = await Promise.all([
        import("@/lib/offline/store"),
        import("@/lib/native/shift"),
        import("@/lib/native/device"),
        import("@/lib/native/widgets"),
      ]);
      await shift.suspendShiftForLogout(userId);
      await store.logoutDisposition(userId, disposition);
      if (disposition === "discard") await shift.discardPrivateDeviceData(userId);
      await device.unregisterPush(request, userId);
      await widgets.clearWidgets();
      await (await import("@/lib/native/shortcuts")).clearAppShortcuts();
      await signOut();
    } catch (error) {
      Alert.alert("Could not sign out", String(error));
    }
  };
  return (
    <Action
      title="Sign out"
      secondary
      onPress={() =>
        Alert.alert(
          "Keep unsynced drafts?",
          "Active shifts pause. Kept drafts remain private to this account on this device.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Discard device drafts",
              style: "destructive",
              onPress: () => void leave("discard"),
            },
            { text: "Keep drafts and sign out", onPress: () => void leave("keep") },
          ],
        )
      }
    />
  );
}
