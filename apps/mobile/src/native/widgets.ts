import { Platform } from "react-native";
import type { Binding } from "../offline/store";
import { readState, writeState } from "../offline/store";
import type { OverviewWidgetProps } from "./widget-types";
// The native widgets have independent bundles; only app code fetches or reads SQLite.
async function widget() {
  if (Platform.OS === "ios") return (await import("./overview-widget.ios")).default;
  if (Platform.OS === "android") return (await import("./overview-widget.android")).default;
  throw new Error("Home screen widgets require an iOS or Android development build.");
}
export async function updateOverviewWidget(
  binding: Binding,
  data: { workspaceName: string; summary: string; syncedAt: number },
) {
  const configuration = await readState<{ workspaceId: string; hidden: boolean }>(
    `widget:${binding.userId}`,
  );
  if (configuration?.workspaceId !== binding.workspaceId) return;
  const props: OverviewWidgetProps = {
    workspaceId: binding.workspaceId,
    ...data,
    syncedAt: new Date(data.syncedAt).toLocaleString(),
    hidden: configuration.hidden,
  };
  (await widget()).updateSnapshot(props);
}
export async function configureWidget(binding: Binding, hidden: boolean) {
  await writeState(`widget:${binding.userId}`, { workspaceId: binding.workspaceId, hidden });
  (await widget()).updateSnapshot({
    workspaceId: binding.workspaceId,
    workspaceName: "Soletrade",
    summary: "Open Soletrade to sync this workspace",
    syncedAt: "Never",
    hidden,
  });
}
export async function clearWidgets() {
  if (Platform.OS === "ios" || Platform.OS === "android")
    (await widget()).updateSnapshot({
      workspaceId: "",
      workspaceName: "Soletrade",
      summary: "Sign in to see your workspace",
      syncedAt: "Never",
      hidden: true,
    });
}
