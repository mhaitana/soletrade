import { View } from "react-native";
import { Copy, Group, Row, formatMoney, human } from "./ui";
import { spacing, radius, useTheme } from "@/theme";
export function TrendChart({
  title,
  points,
  valueKey,
  currency = "AUD",
}: {
  title: string;
  points: Record<string, unknown>[];
  valueKey: string;
  currency?: string;
}) {
  const theme = useTheme();
  const maximum = Math.max(1, ...points.map((point) => Math.abs(Number(point[valueKey] ?? 0))));
  const money = valueKey.endsWith("Cents");
  return (
    <Group title={title}>
      {points.length ? (
        points.map((point, index) => {
          const label = String(
            point.month ??
              point.week ??
              point.label ??
              point.category ??
              point.platform ??
              index + 1,
          );
          const value = Number(point[valueKey] ?? 0);
          const formatted = money
            ? formatMoney(value, currency)
            : valueKey.endsWith("Meters")
              ? `${(value / 1000).toFixed(1)} km`
              : String(value);
          return (
            <View
              key={`${label}:${index}`}
              accessible
              accessibilityLabel={`${human(label)}: ${formatted}`}
              style={{ gap: spacing.xs }}
            >
              <Row title={human(label)} trailing={formatted} />
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{
                  height: spacing.sm,
                  backgroundColor: theme.tint,
                  borderRadius: radius.sm,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: "100%",
                    width: `${Math.max(1, (Math.abs(value) / maximum) * 100)}%`,
                    backgroundColor: value < 0 ? theme.danger : theme.accent,
                  }}
                />
              </View>
            </View>
          );
        })
      ) : (
        <Copy muted>No activity in this period.</Copy>
      )}
    </Group>
  );
}
export function SummaryView({
  summary,
  currency = "AUD",
}: {
  summary: Record<string, unknown>;
  currency?: string;
}) {
  const numbers = Object.entries(summary).filter(([, value]) => typeof value === "number");
  const monthly = Array.isArray(summary.monthly)
    ? (summary.monthly as Record<string, unknown>[])
    : [];
  const valueKey = ["netCents", "paidCents", "acceptedCents", "earningsCents"].find((key) =>
    monthly.some((point) => key in point),
  );
  return (
    <>
      <Group title="Period totals">
        {numbers
          .filter(([key]) => key !== "previousPaidCents")
          .map(([key, value]) => (
            <Row
              key={key}
              title={human(key.replace(/Cents$|Meters$/, ""))}
              trailing={
                key.endsWith("Cents")
                  ? formatMoney(value, currency)
                  : key.endsWith("Meters")
                    ? `${(Number(value) / 1000).toFixed(1)} km`
                    : String(value)
              }
            />
          ))}
        {typeof summary.previousPaidCents === "number" && (
          <Row
            title="Paid in previous period"
            trailing={formatMoney(summary.previousPaidCents, currency)}
          />
        )}
      </Group>
      {valueKey && (
        <TrendChart
          title={`Monthly ${human(valueKey.replace(/Cents$/, "")).toLowerCase()}`}
          points={monthly}
          valueKey={valueKey}
          currency={currency}
        />
      )}
      {Array.isArray(summary.byCategory) && (
        <TrendChart
          title="By category"
          points={summary.byCategory}
          valueKey="amountCents"
          currency={currency}
        />
      )}
      {Array.isArray(summary.byPlatform) && (
        <TrendChart
          title="Earnings by platform"
          points={summary.byPlatform}
          valueKey="earningsCents"
          currency={currency}
        />
      )}
      {Array.isArray(summary.weekly) && (
        <TrendChart
          title="Weekly earnings"
          points={summary.weekly}
          valueKey="earningsCents"
          currency={currency}
        />
      )}
    </>
  );
}
