import { useColorScheme, type TextStyle } from "react-native";
import { designTokens } from "@soletrade/contracts";

const palette = {
  light: {
    background: designTokens.colors.light.background,
    surface: designTokens.colors.light.surface,
    surfaceSubtle: designTokens.colors.light.surfaceSubtle,
    text: designTokens.colors.light.text,
    muted: designTokens.colors.light.mutedForeground,
    line: designTokens.colors.light.line,
    accent: designTokens.colors.light.accent,
    tint: designTokens.colors.light.tint,
    danger: designTokens.colors.light.danger,
    success: designTokens.colors.light.success,
    primary: designTokens.colors.light.primary,
    primaryForeground: designTokens.colors.light.primaryForeground,
    warning: designTokens.colors.light.warning,
    warningTint: designTokens.colors.light.warningTint,
    successTint: designTokens.colors.light.successTint,
    destructiveTint: designTokens.colors.light.destructiveTint,
  },
  dark: {
    background: designTokens.colors.dark.background,
    surface: designTokens.colors.dark.surface,
    surfaceSubtle: designTokens.colors.dark.surfaceSubtle,
    text: designTokens.colors.dark.text,
    muted: designTokens.colors.dark.mutedForeground,
    line: designTokens.colors.dark.line,
    accent: designTokens.colors.dark.accent,
    tint: designTokens.colors.dark.tint,
    danger: designTokens.colors.dark.danger,
    success: designTokens.colors.dark.success,
    primary: designTokens.colors.dark.primary,
    primaryForeground: designTokens.colors.dark.primaryForeground,
    warning: designTokens.colors.dark.warning,
    warningTint: designTokens.colors.dark.warningTint,
    successTint: designTokens.colors.dark.successTint,
    destructiveTint: designTokens.colors.dark.destructiveTint,
  },
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const radius = { sm: 10, md: 16, lg: 22, pill: 9999 } as const;

export const typography: Record<string, TextStyle> = {
  hero: { fontSize: 34, fontWeight: "700" },
  metric: { fontSize: 26, fontWeight: "700", fontVariant: ["tabular-nums"] },
  title: { fontSize: 22, fontWeight: "600" },
  headline: { fontSize: 17, fontWeight: "600" },
  body: { fontSize: 17, fontWeight: "400" },
  caption: { fontSize: 14, fontWeight: "400" },
  mono: { fontSize: 15, fontVariant: ["tabular-nums"] },
} as const;

export function useTheme() {
  return palette[useColorScheme() === "dark" ? "dark" : "light"];
}
