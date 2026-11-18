import { pushRegistrationDue, type PushRegistration } from "@/lib/native/sync-policy";
import { isQuietHour } from "@/lib/offline/policy";
import { deleteState, readState, writeState } from "@/lib/offline/store";
import { Button, Host } from "@expo/ui";
import type { MobilePreferences, MobileRequest } from "@soletrade/contracts";
import { DEFAULT_MOBILE_PREFERENCES } from "@soletrade/contracts";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import { File, Paths } from "expo-file-system";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as Sharing from "expo-sharing";
import React, { useEffect, useState } from "react";
import { AppState, Platform, Text, View } from "react-native";
let notificationPreferences: MobilePreferences = { ...DEFAULT_MOBILE_PREFERENCES };
export function setDeviceNotificationPreferences(preferences: MobilePreferences) {
  notificationPreferences = preferences;
}
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const category = String(
      notification.request.content.data?.category ??
        notification.request.content.categoryIdentifier ??
        "",
    );
    const show =
      !isQuietHour(
        new Date().getHours(),
        notificationPreferences.quietHoursStart,
        notificationPreferences.quietHoursEnd,
      ) && notificationPreferences.notificationCategories.includes(category);
    return {
      shouldShowBanner: show,
      shouldShowList: show,
      shouldPlaySound: show,
      shouldSetBadge: false,
    };
  },
});
export async function deviceId() {
  let value = await SecureStore.getItemAsync("soletrade.testice.id");
  if (!value) {
    value = Crypto.randomUUID();
    await SecureStore.setItemAsync("soletrade.testice.id", value);
  }
  return value;
}
/**
 * Registers this device for push. With `onlyIfChanged`, the POST is skipped when the same token,
 * device, timezone and account/workspace binding were already registered within the last 7 days.
 */
export async function registerPush(
  request: MobileRequest,
  userId: string,
  options?: { onlyIfChanged?: { workspaceId: string } },
) {
  if (!Device.isDevice) throw new Error("Push registration requires a physical device.");
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("important", {
      name: "Business updates",
      importance: AndroidImportance.DEFAULT,
    });
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted)
    throw new Error("Notifications are disabled. You can still view updates in the app.");
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error("Push requires an EAS project ID in this build.");
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  const id = await deviceId();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const binding = {
    deviceId: id,
    platform: Platform.OS,
    token: token.data,
    timezone,
    workspaceId: options?.onlyIfChanged?.workspaceId ?? "",
  };
  const recordKey = `push-registration:${userId}`;
  if (options?.onlyIfChanged) {
    const last = await readState<PushRegistration>(recordKey).catch(() => null);
    if (!pushRegistrationDue(last, binding, Date.now())) return id;
  }
  await request("/me/devices", {
    method: "POST",
    body: {
      deviceId: id,
      platform: Platform.OS,
      token: token.data,
      timezone,
    },
    idempotencyKey: Crypto.randomUUID(),
  });
  await writeState(`push-device:${userId}`, id);
  await writeState(recordKey, { ...binding, registeredAt: Date.now() } satisfies PushRegistration);
  return id;
}
export async function unregisterPush(request: MobileRequest, userId: string) {
  const id = await readState<string>(`push-device:${userId}`);
  if (id) await request(`/me/devices/${id}`, { method: "DELETE" });
  await deleteState(`push-device:${userId}`);
  await deleteState(`push-registration:${userId}`);
  await Notifications.dismissAllNotificationsAsync();
}
export function listenForPush(open: (path: string, workspaceId: string) => void) {
  const handle = (response: Notifications.NotificationResponse) => {
    const { path, workspaceId } = response.notification.request.content.data ?? {};
    if (
      typeof path === "string" &&
      typeof workspaceId === "string" &&
      (path === "/legal" || /^\/(feature|record|resource|\(tabs\))\//.test(path)) &&
      !path.includes("://")
    )
      open(path, workspaceId);
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) handle(response);
  });
  return () => subscription.remove();
}
export async function appLockEnabled(userId: string) {
  return (await SecureStore.getItemAsync(`lock.${userId}`)) === "true";
}
export async function configureAppLock(userId: string, enabled: boolean) {
  if (enabled) {
    if (
      !(await LocalAuthentication.hasHardwareAsync()) ||
      !(await LocalAuthentication.isEnrolledAsync())
    )
      throw new Error("Set up biometrics in device Settings first.");
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Enable Soletrade app lock",
    });
    if (!result.success) throw new Error("Authentication cancelled.");
  }
  await SecureStore.setItemAsync(`lock.${userId}`, String(enabled));
}
export function AppLock({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [locked, setLocked] = useState(true),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const unlock = async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Soletrade" });
    if (result.success) setLocked(false);
    else setError("Unlock cancelled. Your work remains saved.");
  };
  useEffect(() => {
    let live = true;
    void appLockEnabled(userId).then((enabled) => {
      if (live) {
        setLocked(enabled);
        setReady(true);
      }
    });
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active")
        void appLockEnabled(userId).then((enabled) => {
          if (live && enabled) setLocked(true);
        });
    });
    return () => {
      live = false;
      listener.remove();
    };
  }, [userId]);
  if (!ready) return <Text accessibilityRole="text">Checking app lock…</Text>;
  if (!locked) return <>{children}</>;
  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 16 }}>
      <Text accessibilityRole="header">Soletrade is locked</Text>
      <Text>{error}</Text>
      <Host matchContents>
        <Button
          onPress={() => {
            void unlock().catch((e) => setError(String(e)));
          }}
        >
          Unlock
        </Button>
      </Host>
    </View>
  );
}
export async function sharePdf(url: string, fileName = "soletrade.pdf") {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("Sharing is not available on this device.");
  if (!url.startsWith("https://")) throw new Error("A secure signed download URL is required.");
  const destination = new File(
    Paths.cache,
    `${Crypto.randomUUID()}-${fileName.replace(/[^\w.-]/g, "_")}`,
  );
  const file = await File.downloadFileAsync(url, destination);
  await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
}
