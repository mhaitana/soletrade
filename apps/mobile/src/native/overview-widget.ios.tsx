import { VStack, Text, Link } from "@expo/ui/swift-ui";
import { widgetURL, padding, privacySensitive } from "@expo/ui/swift-ui/modifiers";
import { createWidget } from "expo-widgets";
import type { OverviewWidgetProps } from "./widget-types";
const Overview = (props: OverviewWidgetProps) => {
  "widget";
  return (
    <VStack modifiers={[padding({ all: 14 }), privacySensitive(), widgetURL("soletrade://")]}>
      <Text>{props.hidden ? "Soletrade" : props.workspaceName}</Text>
      <Text>{props.hidden ? "Open Soletrade to view your workspace" : props.summary}</Text>
      <Text>{props.hidden ? "" : `Last synced ${props.syncedAt}`}</Text>
      <Link
        label="Capture receipt"
        destination={`soletrade://feature/receipt?workspaceId=${props.workspaceId}`}
      />
      <Link
        label="Start shift"
        destination={`soletrade://feature/shift?workspaceId=${props.workspaceId}`}
      />
    </VStack>
  );
};
export default createWidget("SoletradeOverview", Overview, {
  workspaceId: "",
  workspaceName: "Soletrade",
  summary: "Open Soletrade to sync",
  syncedAt: "Never",
  hidden: true,
});
