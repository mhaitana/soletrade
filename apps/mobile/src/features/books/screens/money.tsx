import { ModuleSummary } from "@/components/module-summary";
import { Action, Copy, Group, NavRow, Screen } from "@/components/ui";
import { listHref } from "@/lib/resources";
import { useSession } from "@/lib/session";
import { router } from "expo-router";

export function MoneyScreen() {
  const { bootstrap, refreshBootstrap } = useSession();
  if (
    bootstrap?.activeWorkspace?.modules.includes("books") &&
    !bootstrap.activeWorkspace.capabilities.includes("view:books")
  )
    return (
      <Screen onRefresh={() => refreshBootstrap()}>
        <Copy variant="title">Money</Copy>
        <Copy>Your workspace role does not include access to Books.</Copy>
      </Screen>
    );
  if (!bootstrap?.activeWorkspace?.modules.includes("books"))
    return (
      <Screen onRefresh={() => refreshBootstrap()}>
        <Copy variant="title">Money</Copy>
        <Copy>Enable Books to keep income, expenses and receipts together.</Copy>
        <NavRow title="Subscription" href="/feature/store" />
      </Screen>
    );
  return (
    <Screen onRefresh={() => refreshBootstrap()}>
      <Copy variant="title">Money</Copy>
      <Copy muted>A clear view of what comes in and goes out.</Copy>
      {bootstrap.activeWorkspace.capabilities.includes("manage:books") && (
        <Action title="Capture receipt" onPress={() => router.push("/feature/receipt")} />
      )}
      <ModuleSummary module="books" />
      <Group>
        <NavRow title="Transactions" href={listHref("books/transactions")} />
        <NavRow title="Receipts" href={listHref("books/receipts")} />
        {bootstrap.activeWorkspace.capabilities.includes("manage:books") && (
          <NavRow title="Capture receipt" href="/feature/receipt" />
        )}
        <NavRow title="GST and BAS" href="/tax" />
        <NavRow title="Reports and export" href="/reports" />
      </Group>
    </Screen>
  );
}
