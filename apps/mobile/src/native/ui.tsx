import React from "react";
import { ScrollView, Text, TextInput, View, useColorScheme } from "react-native";
import { Button, Host } from "@expo/ui";
export function NativePage({ title, children }: { title: string; children: React.ReactNode }) {
  const dark = useColorScheme() === "dark";
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: dark ? "#131b23" : "#f7f5f0" }}
      contentContainerStyle={{
        padding: 20,
        gap: 16,
        paddingBottom: 80,
        backgroundColor: dark ? "#131b23" : "#f7f5f0",
        flexGrow: 1,
        maxWidth: 820,
        width: "100%",
        alignSelf: "center",
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ fontSize: 28, fontWeight: "700", color: dark ? "#fafafa" : "#192b3c" }}
      >
        {title}
      </Text>
      {children}
    </ScrollView>
  );
}
export function Note({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  const dark = useColorScheme() === "dark";
  return (
    <Text
      accessibilityRole={error ? "alert" : "text"}
      selectable
      style={{
        fontSize: 16,
        lineHeight: 24,
        color: error ? (dark ? "#ffb4ab" : "#9f2424") : dark ? "#dce3e9" : "#405367",
      }}
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
  return (
    <Host matchContents={{ vertical: true }} style={{ width: "100%", minHeight: 48 }}>
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
  const dark = useColorScheme() === "dark";
  return (
    <View style={{ gap: 6 }}>
      <Note>{label}</Note>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? "decimal-pad" : "default"}
        style={{
          borderWidth: 1,
          borderColor: "#8195a7",
          borderRadius: 10,
          padding: 12,
          fontSize: 17,
          color: dark ? "#fff" : "#142b40",
          minHeight: 48,
        }}
      />
    </View>
  );
}
