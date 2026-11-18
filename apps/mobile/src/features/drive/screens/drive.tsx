import { ModuleSummary } from "@/components/module-summary";
import { Action, Copy, Group, NavRow, Screen } from "@/components/ui";
import { listHref } from "@/lib/resources";
import { useSession } from "@/lib/session";
import { shareBinary } from "@/lib/sharing";
import { router } from "expo-router";

export function DriveScreen() {
  const { bootstrap, refreshBootstrap } = useSession();
  if (
    bootstrap?.activeWorkspace?.modules.includes("drive") &&
    !bootstrap.activeWorkspace.capabilities.includes("view:drive")
  )
    return (
      <Screen onRefresh={() => refreshBootstrap()}>
        <Copy variant="title">Drive</Copy>
        <Copy>Your workspace role does not include access to Drive.</Copy>
      </Screen>
    );
  if (!bootstrap?.activeWorkspace?.modules.includes("drive"))
    return (
      <Screen onRefresh={() => refreshBootstrap()}>
        <Copy variant="title">Drive</Copy>
        <Copy>Enable Drive to record gig earnings, mileage and vehicle expenses.</Copy>
        <NavRow title="Subscription" href="/feature/store" />
      </Screen>
    );
  return (
    <Screen onRefresh={() => refreshBootstrap()}>
      <Copy variant="title">Drive</Copy>
      <Copy muted>Your working day, from the first kilometre.</Copy>
      {bootstrap.activeWorkspace.capabilities.includes("create:drive") && (
        <Action title="Start or review shift" onPress={() => router.push("/feature/shift")} />
      )}
      <ModuleSummary module="drive" />
      <Group>
        {[
          "drive/earnings",
          "drive/trips",
          "drive/vehicles",
          "drive/expenses",
          "drive/settings",
        ].map((resource) => (
          <NavRow
            key={resource}
            title={
              {
                "drive/earnings": "Earnings",
                "drive/trips": "Mileage",
                "drive/vehicles": "Vehicles",
                "drive/expenses": "Vehicle expenses",
                "drive/settings": "Drive settings",
              }[resource]!
            }
            href={listHref(resource)}
          />
        ))}
      </Group>
      <Action
        title="Export Drive records"
        secondary
        onPress={() => {
          void shareBinary(
            `/workspaces/${bootstrap.activeWorkspace!.id}/drive/export`,
            "drive.csv",
          ).catch((error) => alert(String(error)));
        }}
      />
    </Screen>
  );
}
