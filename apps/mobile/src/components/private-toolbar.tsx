import React, { useMemo } from "react";
import { View, Text } from "react-native";
import { Button, Host, Text as NativeText } from "@expo/ui";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import type { MobileModule } from "@soletrade/contracts";
import { contextualCreate } from "@/lib/global-actions";
import { radius, spacing, useTheme } from "@/theme";

type ToolbarProps = {
  workspaceName: string;
  pathname: string;
  modules: MobileModule[];
  capabilities: string[];
  onNavigate: (href: string) => void;
  topInset?: number;
  leftInset?: number;
  rightInset?: number;
};

/** Session-free navigation chrome, shown only inside the verified workspace's app lock. */
export function PrivateToolbar({
  workspaceName,
  pathname,
  modules,
  capabilities,
  onNavigate,
  topInset = 0,
  leftInset = 0,
  rightInset = 0,
}: ToolbarProps) {
  const theme = useTheme();
  const create = contextualCreate(pathname, modules, capabilities);
  const open = (href: string) => {
    if (pathname !== href) onNavigate(href);
  };

  return (
    <View
      testID="private-toolbar"
      style={{
        paddingTop: topInset,
        paddingLeft: Math.max(spacing.sm, leftInset),
        paddingRight: Math.max(spacing.sm, rightInset),
        backgroundColor: theme.surface,
        borderBottomColor: theme.line,
        borderBottomWidth: 1,
      }}
    >
      <View
        style={{
          width: "100%",
          maxWidth: 820,
          alignSelf: "center",
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.xs,
          paddingVertical: spacing.xs,
        }}
      >
        <View
          style={{
            flex: 1,
            minWidth: 62,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs + 2,
          }}
        >
          {/* Refined Obsidian HB Monogram Badge */}
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              width: 28,
              height: 28,
              borderRadius: radius.sm - 2,
              borderCurve: "continuous",
              backgroundColor: theme.primary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                color: theme.primaryForeground,
                fontSize: 12,
                fontWeight: "900",
                letterSpacing: -0.4,
              }}
            >
              HB
            </Text>
          </View>

          <Host
            seedColor={theme.accent}
            matchContents={{ vertical: true }}
            style={{ flex: 1, minHeight: 44 }}
          >
            <Button
              variant="text"
              onPress={() => open("/workspaces")}
              style={{ width: "100%", height: 44 }}
            >
              <NativeText
                numberOfLines={1}
                textStyle={{ fontSize: 14, fontWeight: "600", color: theme.text }}
              >{`${workspaceName} ▾`}</NativeText>
            </Button>
          </Host>
        </View>

        <ToolbarButton label="Search" width={54} onPress={() => open("/search")} />
        <ToolbarButton label="hAI" width={44} onPress={() => open("/assistant")} />
        {create && (
          <ToolbarButton
            label={create.label}
            width={104}
            primary
            onPress={() => open(create.href)}
          />
        )}
      </View>
    </View>
  );
}

function ToolbarButton({
  label,
  width,
  primary = false,
  onPress,
}: {
  label: string;
  width: number;
  primary?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Host
      seedColor={primary ? theme.primary : theme.accent}
      matchContents={{ vertical: true }}
      style={{ width, minHeight: 44 }}
    >
      <Button
        variant={primary ? "filled" : "text"}
        onPress={onPress}
        style={{ width: "100%", height: 44 }}
      >
        <NativeText
          numberOfLines={2}
          textStyle={{
            fontSize: 14,
            fontWeight: "600",
            textAlign: "center",
            ...(primary ? {} : { color: theme.accent }),
          }}
        >
          {label}
        </NativeText>
      </Button>
    </Host>
  );
}

export function PrivateAppFrame({
  children,
  ...props
}: ToolbarProps & { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const belowToolbar = useMemo(() => ({ ...insets, top: 0 }), [insets]);
  const theme = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <PrivateToolbar
        {...props}
        topInset={insets.top}
        leftInset={insets.left}
        rightInset={insets.right}
      />
      <SafeAreaInsetsContext.Provider value={belowToolbar}>
        <View style={{ flex: 1 }}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}
