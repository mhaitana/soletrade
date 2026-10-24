import { RecordFields } from "@/components/record-fields";
import { TrendChart } from "@/components/trends";
import { Action, Choice, Copy, ErrorNotice, Field, Group, Loading, Screen } from "@/components/ui";
import { type Entity, useResource, useWorkspacePath } from "@/lib/resources";
import { useSession } from "@/lib/session";
import * as Crypto from "expo-crypto";
import { useState } from "react";
import { Alert } from "react-native";

export function TaxScreen() {
  const { request, bootstrap } = useSession();
  const base = useWorkspacePath("books/tax");
  const state = useResource<{
    gstSummary: Record<string, unknown>;
    lodgedPeriods: Entity[];
    currentQuarter: { fiscalYear: number; quarter: number };
    currency: string;
  }>(base);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lodge = () =>
    Alert.alert(
      "Mark this BAS period lodged?",
      "Confirm only after you have lodged this period with the ATO. This records the lodgement in your books.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mark lodged",
          onPress: () => {
            setBusy(true);
            void request(`${base}/lodge`, {
              method: "POST",
              body: { fiscalYear: Number(year), quarter: Number(quarter) },
              idempotencyKey: Crypto.randomUUID(),
            })
              .then(() => state.refresh())
              .catch((cause) => setError(String(cause)))
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  return (
    <Screen>
      <Copy variant="title">GST and BAS</Copy>
      {state.loading && !state.data ? (
        <Loading />
      ) : (
        state.data && (
          <>
            <Group title="GST overview">
              <RecordFields value={{ ...state.data.gstSummary, currency: state.data.currency }} />
            </Group>
            {Array.isArray(state.data.gstSummary.byQuarter) && (
              <TrendChart
                title="Quarterly net GST"
                points={state.data.gstSummary.byQuarter}
                valueKey="netGstCents"
                currency={state.data.currency}
              />
            )}
            <Group title="Lodged periods">
              {state.data.lodgedPeriods.length ? (
                state.data.lodgedPeriods.map((period) => (
                  <RecordFields key={period.id} value={period} />
                ))
              ) : (
                <Copy muted>No periods marked lodged.</Copy>
              )}
            </Group>
            {bootstrap?.activeWorkspace?.capabilities.includes("manage:books") && (
              <Group title="Record a lodgement">
                <Field
                  label="Financial year"
                  value={year}
                  onChangeText={setYear}
                  keyboardType="number-pad"
                />
                <Choice
                  label="Quarter"
                  value={quarter}
                  options={["1", "2", "3", "4"].map((value) => ({ label: `Q${value}`, value }))}
                  onChange={setQuarter}
                />
                <Action title="Mark BAS period lodged" busy={busy} onPress={lodge} />
              </Group>
            )}
          </>
        )
      )}
      {(error || state.error) && (
        <ErrorNotice message={error || state.error!} retry={() => void state.refresh()} />
      )}
    </Screen>
  );
}
