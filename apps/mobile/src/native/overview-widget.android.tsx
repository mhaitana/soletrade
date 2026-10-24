import { Column, Text } from "@expo/ui/jetpack-compose";
import { paddingAll } from "@expo/ui/jetpack-compose/modifiers";
import { createWidget } from "expo-widgets";
import type { OverviewWidgetProps } from "./widget-types";
const Overview = (props: OverviewWidgetProps) => {
  "widget";
  return (
    <Column modifiers={[paddingAll(14)]}>
      <Text>{props.hidden ? "Soletrade" : props.workspaceName}</Text>
      <Text>{props.hidden ? "Open Soletrade to view your workspace" : props.summary}</Text>
      <Text>{props.hidden ? "" : `Last synced ${props.syncedAt}`}</Text>
      <Text>Open Soletrade for receipt capture or Start Shift</Text>
    </Column>
  );
};
export default createWidget("SoletradeOverview", Overview, {
  workspaceId: "",
  workspaceName: "Soletrade",
  summary: "Open Soletrade to sync",
  syncedAt: "Never",
  hidden: true,
});
