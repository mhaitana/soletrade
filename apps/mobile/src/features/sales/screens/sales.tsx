import { Action, Copy, Group, NavRow, Screen } from "@/components/ui";
import { listHref } from "@/lib/resources";
import { useSession } from "@/lib/session";
import { spacing } from "@/theme/index";
import { router } from "expo-router";
import { View } from "react-native";

export function SalesScreen() {
  const { bootstrap, refreshBootstrap } = useSession();
  const modules = bootstrap?.activeWorkspace?.modules ?? [];
  const caps = bootstrap?.activeWorkspace?.capabilities ?? [];
  return (
    <Screen onRefresh={() => refreshBootstrap()}>
      <Copy variant="title">Sales</Copy>
      <Copy muted>Good relationships. Clear proposals. Paid invoices.</Copy>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        {modules.includes("quotes") && caps.includes("manage:quote") && (
          <View style={{ flex: 1 }}>
            <Action title="Create quote" onPress={() => router.push("/edit/quotes/new")} />
          </View>
        )}
        {modules.includes("invoices") && caps.includes("manage:invoice") && (
          <View style={{ flex: 1 }}>
            <Action title="Create invoice" onPress={() => router.push("/edit/invoices/new")} />
          </View>
        )}
      </View>
      <Group>
        <NavRow
          title="Customers"
          subtitle="Contacts, history and notes"
          href={listHref("customers")}
        />
        {modules.includes("invoices") && (
          <NavRow
            title="Invoices"
            subtitle="Draft, send and track payments"
            href={listHref("invoices")}
          />
        )}
        {modules.includes("quotes") && (
          <NavRow
            title="Quotes"
            subtitle="Proposals through to accepted work"
            href={listHref("quotes")}
          />
        )}
      </Group>
    </Screen>
  );
}
