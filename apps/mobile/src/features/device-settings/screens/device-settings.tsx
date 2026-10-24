import { Action, Field, NativePage, Note } from "@/components/native-ui";
import { Status, useOperation } from "@/components/operation";
import {
  appLockEnabled,
  configureAppLock,
  registerPush,
  setDeviceNotificationPreferences,
  unregisterPush,
} from "@/lib/native/device";
import { PrivateRouteMap } from "@/lib/native/route-map";
import {
  deletePrivateRoute,
  listPrivateRouteHistory,
  reconcileRouteDeletions,
  syncPrivateRoute,
  type PrivateRouteHistory,
} from "@/lib/native/shift";
import { clearWidgets, configureWidget } from "@/lib/native/widgets";
import { writeState } from "@/lib/offline/store";
import { Host, Switch } from "@expo/ui";
import type { MobileFeatureProps, MobilePreferences } from "@soletrade/contracts";
import { DEFAULT_MOBILE_PREFERENCES } from "@soletrade/contracts";
import { useEffect, useState } from "react";
import { View } from "react-native";

export function DeviceSettingsScreen(props: MobileFeatureProps) {
  return <DeviceSettings key={`${props.userId}:${props.workspaceId}`} {...props} />;
}

export function DeviceSettings(incoming: MobileFeatureProps) {
  const [props] = useState(incoming);
  const op = useOperation(),
    [preferences, setPreferences] = useState<MobilePreferences | null>(null),
    [locked, setLocked] = useState(false),
    [start, setStart] = useState("22"),
    [end, setEnd] = useState("7"),
    [routes, setRoutes] = useState<PrivateRouteHistory[]>([]),
    [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const { run } = op;
  useEffect(() => {
    void run(async () => {
      const value = await props.request<MobilePreferences>("/me/preferences");
      setPreferences(value);
      setDeviceNotificationPreferences(value);
      setStart(String(value.quietHoursStart));
      setEnd(String(value.quietHoursEnd));
      setLocked(await appLockEnabled(props.userId));
      await reconcileRouteDeletions(props, props.request);
      setRoutes(await listPrivateRouteHistory(props));
    });
  }, [props, run]);
  const save = async (next: MobilePreferences) => {
    const value = await props.request<MobilePreferences>("/me/preferences", {
      method: "PATCH",
      body: next,
    });
    setPreferences(value);
    setDeviceNotificationPreferences(value);
    await writeState(`preferences:${props.userId}`, value);
    return "Preferences saved.";
  };
  return (
    <NativePage title="Device & privacy">
      <Status operation={op} />
      {!preferences ? (
        <>
          <Note>
            Connect to load your preferences. GPS sync defaults off; quiet hours default to
            22:00–07:00.
          </Note>
          <Action
            title="Retry preferences"
            onPress={() =>
              void run(async () => {
                setPreferences(await props.request("/me/preferences"));
              })
            }
          />
        </>
      ) : (
        <>
          <Host matchContents>
            <Switch
              label="Sync precise routes to my private account"
              value={preferences.routeSyncEnabled}
              disabled={op.busy}
              onValueChange={(value) =>
                void run(() => save({ ...preferences, routeSyncEnabled: value }))
              }
            />
          </Host>
          <Note>
            Precise routes are private to you. Workspace members receive reviewed mileage only.
            Turning sync off does not delete previously uploaded routes.
          </Note>
          <Field
            label="Quiet hours start (local hour 0–23)"
            value={start}
            onChange={setStart}
            numeric
          />
          <Field label="Quiet hours end (local hour 0–23)" value={end} onChange={setEnd} numeric />
          <Action
            title="Save local quiet hours"
            disabled={op.busy}
            onPress={() =>
              void run(async () => {
                const a = Number(start),
                  b = Number(end);
                if (
                  !Number.isInteger(a) ||
                  !Number.isInteger(b) ||
                  a < 0 ||
                  a > 23 ||
                  b < 0 ||
                  b > 23
                )
                  throw new Error("Use whole hours from 0 to 23.");
                return save({ ...preferences, quietHoursStart: a, quietHoursEnd: b });
              })
            }
          />
          {DEFAULT_MOBILE_PREFERENCES.notificationCategories.map((category) => (
            <Host matchContents key={category}>
              <Switch
                label={category}
                value={preferences.notificationCategories.includes(category)}
                disabled={op.busy}
                onValueChange={(value) =>
                  void run(() =>
                    save({
                      ...preferences,
                      notificationCategories: value
                        ? [...preferences.notificationCategories, category]
                        : preferences.notificationCategories.filter((item) => item !== category),
                    }),
                  )
                }
              />
            </Host>
          ))}
        </>
      )}
      {routes.map((route) => (
        <View key={route.id} style={{ gap: 8 }}>
          <Note>
            Private route · {new Date(route.startedAt).toLocaleString()} ·{" "}
            {route.deleted ? "deleted" : `${route.pointCount} samples`}
          </Note>
          {!route.deleted && (
            <>
              <Action
                title="Review private route map"
                onPress={() => setSelectedRoute(selectedRoute === route.id ? null : route.id)}
              />
              {selectedRoute === route.id && (
                <PrivateRouteMap
                  key={route.id}
                  userId={props.userId}
                  workspaceId={props.workspaceId}
                  routeId={route.id}
                />
              )}
              {!route.remote && (
                <Action
                  title="Sync this private route"
                  disabled={op.busy}
                  onPress={() =>
                    void run(async () => {
                      const current = await props.request<MobilePreferences>("/me/preferences");
                      await syncPrivateRoute(
                        props,
                        props.request,
                        current.routeSyncEnabled,
                        route.id,
                      );
                      return "Private route synced.";
                    })
                  }
                />
              )}
              <Action
                title="Delete this route on all devices"
                disabled={op.busy}
                onPress={() =>
                  void run(async () => {
                    try {
                      await deletePrivateRoute(props, props.request, route.id);
                    } finally {
                      setRoutes(await listPrivateRouteHistory(props));
                    }
                    return "Route deleted.";
                  })
                }
              />
            </>
          )}
        </View>
      ))}
      <Action
        title="Enable notifications on this device"
        disabled={op.busy}
        onPress={() =>
          void run(async () => {
            await registerPush(props.request, props.userId);
            return "This device is registered for your selected notifications.";
          })
        }
      />
      <Action
        title="Unregister device notifications"
        disabled={op.busy}
        onPress={() =>
          void run(async () => {
            await unregisterPush(props.request, props.userId);
            return "This device was unregistered.";
          })
        }
      />
      <Note>
        Push is a reminder. Open the app to see the current record. Background alerts are suppressed
        by the server using your saved local quiet hours.
      </Note>
      <Host matchContents>
        <Switch
          label="Require biometrics to unlock Soletrade"
          value={locked}
          disabled={op.busy}
          onValueChange={(value) =>
            void run(async () => {
              await configureAppLock(props.userId, value);
              setLocked(value);
            })
          }
        />
      </Host>
      <Action
        title="Show this workspace on home screen widget"
        disabled={op.busy}
        onPress={() =>
          void run(async () => {
            await configureWidget(props, false);
            return "Widget bound to this workspace. Open Home to refresh its last-synced overview.";
          })
        }
      />
      <Action
        title="Hide widget business information"
        disabled={op.busy}
        onPress={() =>
          void run(async () => {
            await configureWidget(props, true);
            await clearWidgets();
            return "Business details hidden.";
          })
        }
      />
      <Note>
        Widgets show a snapshot and its sync time. iOS widget actions open the app for receipt
        capture or Start Shift. Android provides a separate Soletrade quick actions widget for receipt
        capture, Start Shift and a new invoice. You can also press and hold the app icon for quick
        actions. Start and stop each shift explicitly and review its distance before saving.
      </Note>
      <Note>
        Background location can be interrupted by device battery settings, force quit or permission
        changes. Always review the distance before saving.
      </Note>
    </NativePage>
  );
}
