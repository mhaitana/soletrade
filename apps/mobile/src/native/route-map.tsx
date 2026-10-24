import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import Constants from "expo-constants";
import type { Binding } from "../offline/policy";
import { privateRouteDetails } from "./shift";
import { routeSegments, summarizePoints } from "./gps-policy";
import { Note } from "./ui";
export function PrivateRouteMap({ userId, workspaceId, routeId }: Binding & { routeId: string }) {
  const [route, setRoute] = useState<Awaited<ReturnType<typeof privateRouteDetails>> | null>(null),
    [error, setError] = useState("");
  const map = useRef<MapView | null>(null);
  useEffect(() => {
    let live = true;
    void privateRouteDetails({ userId, workspaceId }, routeId)
      .then((value) => {
        if (live) setRoute(value);
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      live = false;
    };
  }, [userId, workspaceId, routeId]);
  if (error) return <Note error>{error}</Note>;
  if (!route) return <ActivityIndicator accessibilityLabel="Loading private route" />;
  const segments = routeSegments(route.points),
    points = segments.flat(),
    summary = summarizePoints(route.points),
    start = points[0],
    end = points.at(-1);
  const androidKey =
    Constants.expoConfig?.android?.config?.googleMaps?.apiKey ??
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  return (
    <View style={{ gap: 10 }}>
      <Note>
        Reviewed distance: {(route.distanceMeters / 1000).toFixed(2)} km · {summary.gaps} detected
        gaps. {new Date(route.startedAt).toLocaleString()}
        {route.endedAt ? ` to ${new Date(route.endedAt).toLocaleString()}` : ""}. Pauses and
        unreliable samples appear as separate lines.
      </Note>
      {!start ? (
        <Note>
          No reliable location samples are available. The reviewed mileage summary is retained.
        </Note>
      ) : Platform.OS === "android" && !androidKey ? (
        <Note>
          Map preview is unavailable in this Android build. Configure the Google Maps key and
          rebuild to show the private route. Your reviewed distance and gap summary remain
          available.
        </Note>
      ) : (
        <MapView
          key={routeId}
          ref={map}
          accessibilityLabel="Private recorded route map. Start and finish markers with separate lines for recording segments."
          style={{ height: 300, width: "100%", borderRadius: 12 }}
          showsUserLocation={false}
          showsMyLocationButton={false}
          toolbarEnabled={false}
          initialRegion={{
            latitude: start.latitude,
            longitude: start.longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
          onMapReady={() =>
            map.current?.fitToCoordinates(points, {
              edgePadding: { top: 40, right: 40, bottom: 40, left: 40 },
              animated: false,
            })
          }
        >
          {segments
            .filter((segment) => segment.length >= 2)
            .map((segment, index) => (
              <Polyline key={index} coordinates={segment} strokeWidth={4} strokeColor="#245fba" />
            ))}
          <Marker
            coordinate={start}
            title="Start"
            description={new Date(start.timestamp).toLocaleString()}
          />
          {end && points.length > 1 && (
            <Marker
              coordinate={end}
              title="Finish"
              pinColor="#23784f"
              description={new Date(end.timestamp).toLocaleString()}
            />
          )}
        </MapView>
      )}
    </View>
  );
}
