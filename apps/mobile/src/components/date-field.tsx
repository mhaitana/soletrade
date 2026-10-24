import { Action, Field } from "@/components/ui";
import { spacing, useTheme } from "@/theme/index";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { useState } from "react";
import { View } from "react-native";
export function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  const parts = value.split("-").map(Number);
  const selected =
    parts.length === 3 && parts.every(Number.isFinite)
      ? new Date(parts[0], parts[1] - 1, parts[2], 12)
      : new Date();
  return (
    <View style={{ gap: spacing.sm }}>
      <Field
        label={label}
        value={value}
        placeholder="YYYY-MM-DD"
        onChangeText={onChange}
        keyboardType="numbers-and-punctuation"
      />
      <Action
        title={`Choose ${label.replace(/\s*\*$/, "").toLowerCase()}`}
        secondary
        onPress={() => setOpen((previous) => !previous)}
      />
      {open && (
        <DateTimePicker
          value={Number.isNaN(selected.getTime()) ? new Date() : selected}
          mode="date"
          display="default"
          accentColor={theme.accent}
          onDismiss={() => setOpen(false)}
          onValueChange={(_event, date) => {
            onChange(
              `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
            );
            setOpen(false);
          }}
        />
      )}
    </View>
  );
}
