import { Action, Field, NativePage, Note } from "@/components/native-ui";
import { Status, useOperation } from "@/components/operation";
import { gigAppLabel, gigAppLink } from "@/lib/native/gig-launch";
import { summarizePoints } from "@/lib/native/gps-policy";
import {
  changeShift,
  continueManualShift,
  currentShift,
  deletePrivateRoute,
  recoverShift,
  saveReviewedShift,
  startShift,
  syncPrivateRoute,
  type ShiftSession,
} from "@/lib/native/shift";
import { syncOutbox } from "@/lib/offline/store";
import type { CollectionPage, MobileFeatureProps, MobilePreferences } from "@soletrade/contracts";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking } from "react-native";

export function ShiftScreen(props: MobileFeatureProps) {
  return <Shift key={`${props.userId}:${props.workspaceId}`} {...props} />;
}

export function Shift(incoming: MobileFeatureProps) {
  const [props] = useState(incoming);
  const op = useOperation(),
    [shift, setShift] = useState<ShiftSession | null>(null),
    [loaded, setLoaded] = useState(false),
    [platform, setPlatform] = useState("other"),
    [vehicleId, setVehicleId] = useState(""),
    [vehicles, setVehicles] = useState<{ id: string; name?: string; registration?: string }[]>([]),
    [distance, setDistance] = useState(""),
    [purpose, setPurpose] = useState("");
  const { run } = op;
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const value = await recoverShift(props);
        if (live) {
          setShift(value);
          if (value && ["review", "saved"].includes(value.status))
            setDistance(String(summarizePoints(value.points).distanceMeters / 1000));
        }
      } catch (error) {
        if (live)
          void run(async () => {
            throw error;
          });
      } finally {
        if (live) setLoaded(true);
      }
    };
    void load();
    const timer = setInterval(() => {
      void currentShift(props)
        .then((value) => {
          if (live) setShift(value);
        })
        .catch(() => undefined);
    }, 5000);
    void props
      .request<CollectionPage<{ id: string; name?: string; registration?: string }>>(
        `/workspaces/${props.workspaceId}/drive/vehicles`,
      )
      .then((value) => {
        if (live) setVehicles(value.items);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [props, run]);
  const summary = summarizePoints(shift?.points ?? []);
  const openGigApp = async (platformId: string, status: string, manual: boolean) => {
    const link = gigAppLink(platformId);
    if (!link) return "Shift started. Open your gig app from your home screen.";
    const retained = `${status} (${manual ? "manual distance" : "GPS"})`;
    try {
      await Linking.openURL(link);
      return `Opened the configured ${gigAppLabel(platformId)} link. Your shift remains ${retained}.`;
    } catch {
      return `Could not open ${gigAppLabel(platformId)}. Your shift remains ${retained}; use normal app switching.`;
    }
  };
  const transition = (action: "pause" | "resume" | "stop") =>
    void run(async () => {
      const result = await changeShift(props, action);
      setShift(result);
      if (action === "stop")
        setDistance(String(summarizePoints(result.points).distanceMeters / 1000));
    });
  return (
    <NativePage title="Your shift">
      <Note>
        You control recording. Each reviewed shift creates one mileage record. GPS never determines
        whether a trip is business related.
      </Note>
      <Status operation={op} />
      {!loaded ? (
        <ActivityIndicator />
      ) : !shift || shift.status === "saved" ? (
        <>
          <Note>Choose the platform and vehicle used for the whole shift.</Note>
          {[
            { id: "uber", name: "Uber" },
            { id: "uber_eats", name: "Uber Eats" },
            { id: "doordash", name: "DoorDash" },
            { id: "airtasker", name: "Airtasker" },
            { id: "menulog", name: "Menulog" },
            { id: "lyft", name: "Lyft" },
            { id: "instacart", name: "Instacart" },
            { id: "other", name: "Other" },
          ].map((item) => (
            <Action
              key={item.id}
              title={`${platform === item.id ? "✓ " : ""}${item.name}`}
              onPress={() => setPlatform(item.id)}
            />
          ))}
          {vehicles.map((vehicle) => (
            <Action
              key={vehicle.id}
              title={`${vehicleId === vehicle.id ? "✓ " : ""}${vehicle.name ?? vehicle.registration ?? "Business vehicle"}`}
              onPress={() => setVehicleId(vehicle.id)}
            />
          ))}
          {vehicles.length === 0 && <Note>Add a vehicle online in Drive before starting.</Note>}
          <Action
            title="Start GPS shift"
            disabled={op.busy}
            onPress={() =>
              void run(async () => {
                try {
                  const started = await startShift(props, platform, vehicleId);
                  setShift(started);
                  return await openGigApp(started.platform, started.status, started.manual);
                } finally {
                  setShift(await currentShift(props));
                }
              })
            }
          />
          <Action
            title="Start manual shift"
            disabled={op.busy}
            onPress={() =>
              void run(async () => {
                const started = await startShift(props, platform, vehicleId, true);
                setShift(started);
                return await openGigApp(started.platform, started.status, started.manual);
              })
            }
          />
        </>
      ) : (
        <>
          <Note>
            Tracking: {shift.status} · {shift.manual ? "manual distance" : "GPS"} ·{" "}
            {shift.platform.replaceAll("_", " ")}
          </Note>
          <Note>
            Vehicle:{" "}
            {vehicles.find((vehicle) => vehicle.id === shift.vehicleId)?.name ??
              "Selected business vehicle"}
          </Note>
          <Note>Measured distance: {(summary.distanceMeters / 1000).toFixed(2)} km</Note>
          <Note>
            Last sample:{" "}
            {summary.lastSample ? new Date(summary.lastSample).toLocaleString() : "No samples yet"}
          </Note>
          <Note>
            Detected gaps: {summary.gaps}. Pauses and missing or inaccurate samples are excluded.
            Correct the reviewed distance for any missing travel.
          </Note>
          {shift.error && <Note error>{shift.error}</Note>}
          {["recording", "paused"].includes(shift.status) && gigAppLink(shift.platform) && (
            <Action
              title={`Open ${gigAppLabel(shift.platform)} app`}
              disabled={op.busy}
              onPress={() => void run(() => openGigApp(shift.platform, shift.status, shift.manual))}
            />
          )}
          {shift.status === "recording" && (
            <Action
              title="Pause recording"
              disabled={op.busy}
              onPress={() => transition("pause")}
            />
          )}
          {shift.status === "paused" && (
            <>
              <Action
                title="Resume recording"
                disabled={op.busy}
                onPress={() => transition("resume")}
              />
              <Action
                title="Continue with manual distance"
                disabled={op.busy}
                onPress={() =>
                  void run(async () => {
                    setShift(await continueManualShift(props));
                  })
                }
              />
            </>
          )}
          {["recording", "paused"].includes(shift.status) && (
            <Action
              title="Stop & review shift"
              disabled={op.busy}
              onPress={() => transition("stop")}
            />
          )}
          {shift.status === "review" && (
            <>
              <Field
                label="Reviewed total distance (km)"
                value={distance}
                onChange={setDistance}
                numeric
              />
              <Field
                label="Business purpose — your assessment"
                value={purpose}
                onChange={setPurpose}
              />
              <Action
                title="Save reviewed mileage"
                disabled={op.busy}
                onPress={() =>
                  void run(async () => {
                    await saveReviewedShift(props, Math.round(Number(distance) * 1000), purpose);
                    const report = await syncOutbox(props, props.request);
                    setShift(await currentShift(props));
                    props.onSaved?.();
                    return report.failed
                      ? "Mileage queued in Drafts; retry when online."
                      : "Reviewed mileage saved.";
                  })
                }
              />
              <Action
                title="Sync precise route privately (requires opt in)"
                disabled={op.busy}
                onPress={() =>
                  void run(async () => {
                    const preferences = await props.request<MobilePreferences>("/me/preferences");
                    await syncPrivateRoute(props, props.request, preferences.routeSyncEnabled);
                    return "Private route synced to your account.";
                  })
                }
              />
              <Action
                title="Delete precise route from all devices"
                disabled={op.busy}
                onPress={() =>
                  void run(async () => {
                    await deletePrivateRoute(props, props.request);
                    setShift(await currentShift(props));
                    return "Route deletion recorded.";
                  })
                }
              />
            </>
          )}
        </>
      )}
      <Note>
        Automatic app detection is off. Starting a shift may open your selected gig app when an app
        link is available. You can also switch apps yourself. App launch failure does not stop your
        shift.
      </Note>
      <Action title="Open device app settings" onPress={() => void Linking.openSettings()} />
      <Note>
        iPhone Shortcuts: create a shortcut with Open URLs → soletrade://feature/shift. Name it “Start
        Shift”. It opens this screen; you choose the vehicle and confirm Start. Android: add the
        Soletrade quick actions widget from your launcher’s Widgets menu.
      </Note>
    </NativePage>
  );
}
