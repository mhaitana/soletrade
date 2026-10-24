import { radius, spacing, typography, useTheme } from "@/theme/index";
import { Button, Host } from "@expo/ui";
import React from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

export function NativePage({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{
        padding: spacing.md + 4,
        gap: spacing.md,
        paddingBottom: spacing.xxl + 32,
        backgroundColor: theme.background,
        flexGrow: 1,
        maxWidth: 820,
        width: "100%",
        alignSelf: "center",
      }}
    >
      <Text accessibilityRole="header" style={[typography.title, { color: theme.text }]}>
        {title}
      </Text>
      {children}
    </ScrollView>
  );
}

export function Note({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  const theme = useTheme();
  return (
    <Text
      accessibilityRole={error ? "alert" : "text"}
      selectable
      style={[
        typography.body,
        {
          fontSize: 15,
          lineHeight: 22,
          color: error ? theme.danger : theme.muted,
        },
      ]}
    >
      {children}
    </Text>
  );
}

export function Action({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Host
      seedColor={theme.primary}
      matchContents={{ vertical: true }}
      style={{ width: "100%", minHeight: 48 }}
    >
      <Button disabled={disabled} onPress={onPress}>
        {title}
      </Button>
    </Host>
  );
}

export function Field({
  label,
  value,
  onChange,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Note>{label}</Note>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? "decimal-pad" : "default"}
        placeholderTextColor={theme.muted}
        style={[
          typography.body,
          {
            borderWidth: 1,
            borderColor: theme.line,
            borderRadius: radius.sm,
            borderCurve: "continuous",
            backgroundColor: theme.surfaceSubtle,
            padding: spacing.md,
            fontSize: 16,
            color: theme.text,
            minHeight: 48,
          },
        ]}
      />
    </View>
  );
}
