import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { Host, Button, Picker, Switch } from "@expo/ui";
import { router } from "expo-router";
import { radius, spacing, typography, useTheme } from "@/theme";

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
export function Screen({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: theme.background }}
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
      seedColor={theme.accent}
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
    <View style={{ gap: spacing.sm }}>
      <Copy variant="caption">{label}</Copy>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={theme.muted}
        style={[
          typography.body,
          {
            color: theme.text,
            borderBottomColor: error ? theme.danger : theme.line,
            borderBottomWidth: 1,
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
  onPress,
}: {
  title: string;
  subtitle?: string;
  trailing?: string;
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
