import { radius, spacing, typography, useTheme } from "@/theme/index";
import { Button, Host, Picker, Switch } from "@expo/ui";
import { router } from "expo-router";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

export function Copy({
  children,
  variant = "body",
  muted = false,
}: {
  children: React.ReactNode;
  variant?: keyof typeof typography;
  muted?: boolean;
}) {
  const theme = useTheme();
  return (
    <Text selectable style={[typography[variant], { color: muted ? theme.muted : theme.text }]}>
      {children}
    </Text>
  );
}

type PullRefreshHandler = () => unknown;
const PullRefreshContext = createContext<((handler: PullRefreshHandler) => () => void) | null>(
  null,
);
/** Lets a child of a pull-to-refresh `Screen` refresh its own data when the user pulls. */
export function usePullRefresh(handler: PullRefreshHandler) {
  const register = useContext(PullRefreshContext);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => register?.(() => latest.current()), [register]);
}

export function Screen({
  children,
  onRefresh,
}: {
  children: React.ReactNode;
  /** Enables pull-to-refresh. Children can add handlers with `usePullRefresh`. */
  onRefresh?: () => unknown;
}) {
  const theme = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const handlers = useRef(new Set<PullRefreshHandler>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const register = useCallback((handler: PullRefreshHandler) => {
    handlers.current.add(handler);
    return () => {
      handlers.current.delete(handler);
    };
  }, []);
  const pull = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled(
        [onRefresh, ...handlers.current].map(async (handler) => handler?.()),
      );
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [onRefresh]);
  return (
    <PullRefreshContext value={register}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1, backgroundColor: theme.background }}
        refreshControl={
          onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={pull} /> : undefined
        }
        contentContainerStyle={{
          padding: spacing.md,
          paddingBottom: spacing.xxl,
          gap: spacing.lg,
          maxWidth: 820,
          width: "100%",
          alignSelf: "center",
        }}
      >
        {children}
      </ScrollView>
    </PullRefreshContext>
  );
}

export function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      {title && <Copy variant="headline">{title}</Copy>}
      <View
        style={{
          backgroundColor: theme.surface,
          borderRadius: radius.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: theme.line,
          padding: spacing.md,
          gap: spacing.md,
        }}
      >
        {children}
      </View>
    </View>
  );
}

export function Action({
  title,
  onPress,
  disabled = false,
  busy = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  secondary?: boolean;
}) {
  const theme = useTheme();
  return (
    <Host
      seedColor={secondary ? theme.accent : theme.primary}
      matchContents={{ vertical: true }}
      style={{ width: "100%", minHeight: 44 }}
    >
      <Button
        testID={title}
        label={busy ? `${title}…` : title}
        variant={secondary ? "outlined" : "filled"}
        disabled={disabled || busy}
        onPress={onPress}
      />
    </Host>
  );
}

export function Field({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Copy variant="caption" muted>
        {label}
      </Copy>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={theme.muted}
        style={[
          typography.body,
          {
            color: theme.text,
            backgroundColor: theme.surfaceSubtle,
            borderColor: error ? theme.danger : theme.line,
            borderWidth: 1,
            borderRadius: radius.sm,
            borderCurve: "continuous",
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            minHeight: 44,
          },
          props.style,
        ]}
      />
      {error && <ErrorNotice message={error} />}
    </View>
  );
}

export function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  const theme = useTheme();

  // If 6 or fewer options, render modern scrollable filter pills
  if (options.length <= 6) {
    return (
      <View style={{ gap: spacing.xs }}>
        <Copy variant="caption" muted>
          {label}
        </Copy>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.xs, paddingVertical: 2 }}
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{ selected }}
                onPress={() => onChange(option.value)}
                // The pill itself stays compact; this wrapper gives it a 44pt touch target.
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <View
                  style={{
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs + 2,
                    borderRadius: radius.pill,
                    backgroundColor: selected ? theme.primary : theme.surfaceSubtle,
                    borderWidth: 1,
                    borderColor: selected ? theme.primary : theme.line,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: selected ? "600" : "500",
                      color: selected ? theme.primaryForeground : theme.text,
                    }}
                  >
                    {option.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.xs }}>
      <Copy variant="caption">{label}</Copy>
      <Host
        seedColor={theme.accent}
        matchContents={{ vertical: true }}
        style={{ width: "100%", minHeight: 44 }}
      >
        <Picker selectedValue={value} onValueChange={onChange}>
          {options.map((option) => (
            <Picker.Item key={option.value} {...option} />
          ))}
        </Picker>
      </Host>
    </View>
  );
}

export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <Host
      seedColor={theme.accent}
      matchContents={{ vertical: true }}
      style={{ width: "100%", minHeight: 44 }}
    >
      <Switch label={label} value={value} onValueChange={onChange} />
    </Host>
  );
}

export function Row({
  title,
  subtitle,
  trailing,
  badge,
  onPress,
}: {
  title: string;
  subtitle?: string;
  trailing?: string;
  badge?: React.ReactNode;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const body = (
    <>
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Copy variant="headline">{title}</Copy>
        {subtitle && (
          <Copy variant="caption" muted>
            {subtitle}
          </Copy>
        )}
        {badge}
      </View>
      {trailing && <Copy muted>{trailing}</Copy>}
    </>
  );
  const style = {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.line,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    minHeight: 60,
  };
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle, trailing].filter(Boolean).join(", ")}
      onPress={onPress}
      style={({ pressed }) => [style, { opacity: pressed ? 0.6 : 1 }]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={style}>{body}</View>
  );
}

export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  const theme = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={{ gap: spacing.sm }}>
      <Text style={[typography.caption, { color: theme.danger }]}>{message}</Text>
      {retry && <Action title="Try again" secondary onPress={retry} />}
    </View>
  );
}

export function Loading() {
  const theme = useTheme();
  return (
    <View accessibilityLabel="Loading" style={{ padding: spacing.lg }}>
      <ActivityIndicator color={theme.accent} />
      <Copy muted>Loading your workspace…</Copy>
    </View>
  );
}

export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: { title: string; onPress: () => void };
}) {
  return (
    <Group>
      <Copy variant="title">{title}</Copy>
      {detail && <Copy muted>{detail}</Copy>}
      {action && <Action {...action} />}
    </Group>
  );
}

export function NavRow({
  title,
  subtitle,
  href,
}: {
  title: string;
  subtitle?: string;
  href: string;
}) {
  return (
    <Row
      title={title}
      subtitle={subtitle}
      trailing="›"
      onPress={() => router.push(href as never)}
    />
  );
}

export function StatusPill({
  label,
  variant = "neutral",
}: {
  label: string;
  variant?: "success" | "warning" | "danger" | "neutral" | "accent";
}) {
  const theme = useTheme();
  const styles = {
    success: { bg: theme.successTint, text: theme.success, border: theme.success + "33" },
    warning: { bg: theme.warningTint, text: theme.warning, border: theme.warning + "33" },
    danger: { bg: theme.destructiveTint, text: theme.danger, border: theme.danger + "33" },
    accent: { bg: theme.tint, text: theme.accent, border: theme.accent + "33" },
    neutral: { bg: theme.surfaceSubtle, text: theme.muted, border: theme.line },
  }[variant];

  return (
    <View
      style={{
        paddingHorizontal: spacing.sm + 2,
        paddingVertical: 3,
        borderRadius: radius.pill,
        backgroundColor: styles.bg,
        borderWidth: 1,
        borderColor: styles.border,
        alignSelf: "flex-start",
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: "600",
          color: styles.text,
          letterSpacing: 0.2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/** Matches the web KPI card: up and new are positive, down is negative, whatever the metric. */
const trendStyle = {
  up: { variant: "success", mark: "↑" },
  new: { variant: "success", mark: "✦" },
  down: { variant: "danger", mark: "↓" },
  flat: { variant: "neutral", mark: "→" },
} as const;

export function KpiTile({
  label,
  value,
  delta,
  trend,
  onPress,
}: {
  label: string;
  value: string;
  /** Text such as "+12% vs last month". */
  delta?: string;
  /** Direction of the change. The tile shows an arrow as well as colour. */
  trend?: keyof typeof trendStyle;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const style = trend ? trendStyle[trend] : undefined;
  const content = (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.surface,
        borderColor: theme.line,
        borderWidth: 1,
        borderRadius: radius.md,
        borderCurve: "continuous",
        padding: spacing.md,
        gap: spacing.xs,
        justifyContent: "space-between",
        minHeight: 96,
      }}
    >
      <Text style={[typography.caption, { color: theme.muted }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[typography.metric, { color: theme.text }]} numberOfLines={1}>
        {value}
      </Text>
      {delta ? (
        <View style={{ alignSelf: "flex-start", marginTop: 2 }}>
          <StatusPill
            label={style ? `${style.mark} ${delta}` : delta}
            variant={style?.variant ?? "neutral"}
          />
        </View>
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}${delta ? `, ${delta}` : ""}`}
        onPress={onPress}
        style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.7 : 1 }]}
      >
        {content}
      </Pressable>
    );
  }
  return content;
}

export function formatMoney(cents: unknown, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(
    Number(cents ?? 0) / 100,
  );
}

export function human(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_.-]/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}
