import { RecordFields } from "@/components/record-fields";
import { Action, Copy, ErrorNotice, Group, Loading, NavRow, Screen, human } from "@/components/ui";
import { type Entity, useResource, useWorkspacePath } from "@/lib/resources";
import * as Linking from "expo-linking";

export function BillingScreen() {
  const path = useWorkspacePath("billing");
  const state = useResource<Entity>(path);
  return (
    <Screen>
      <Copy variant="title">Subscription</Copy>
      {state.loading && !state.data ? (
        <Loading />
      ) : state.data ? (
        <Group>
          <RecordFields value={state.data} />
        </Group>
      ) : null}
      {state.error && <ErrorNotice message={state.error} retry={() => void state.refresh()} />}
      {state.data && (
        <>
          <Group title="Active modules">
            <Copy>
              {Array.isArray(state.data.modules)
                ? state.data.modules.map(String).map(human).join(", ")
                : "No active modules"}
            </Copy>
          </Group>
          {Array.isArray(state.data.recentLedger) && state.data.recentLedger.length > 0 && (
            <Group title="Recent web credit activity">
              {state.data.recentLedger.map((entry, index) => (
                <RecordFields key={index} value={entry} />
              ))}
            </Group>
          )}
          {typeof state.data.managementUrl === "string" && (
            <Action
              title="Manage provider subscription"
              secondary
              onPress={() => void Linking.openURL(String(state.data!.managementUrl))}
            />
          )}
        </>
      )}
      <NavRow title="Manage native subscription" href="/feature/store" />
      <Copy muted>
        Each workspace has one billing provider. Existing coverage must end before switching
        providers.
      </Copy>
    </Screen>
  );
}
