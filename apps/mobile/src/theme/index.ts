import { useColorScheme } from "react-native";

const palette = {
  light: {
    background: "#F6F5F1",
    surface: "#FFFFFF",
    text: "#182B3A",
    muted: "#596976",
    line: "#D9DFE2",
    accent: "#1766AF",
    tint: "#E7F1FA",
    danger: "#B42332",
    success: "#23744F",
  },
  dark: {
    background: "#111A22",
    surface: "#1B2832",
    text: "#F2F4F6",
    muted: "#ACBAC5",
    line: "#354550",
    accent: "#8CC3FA",
    tint: "#243E56",
    danger: "#FFABB0",
    success: "#80D4AC",
  },
} as const;
export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };
export const radius = { sm: 8, md: 12, lg: 16 };
export const typography = {
  hero: { fontSize: 34, fontWeight: "700" },
  title: { fontSize: 22, fontWeight: "600" },
  headline: { fontSize: 17, fontWeight: "600" },
  body: { fontSize: 17, fontWeight: "400" },
  caption: { fontSize: 14, fontWeight: "400" },
} as const;
export function useTheme() {
  return palette[useColorScheme() === "dark" ? "dark" : "light"];
}
