import { SignOutButton } from "@/components/sign-out-button";
import { listHref } from "@/lib/resources";
import { useSession } from "@/lib/session";
import { radius, spacing, typography, useTheme } from "@/theme/index";
import { FieldGroup, Host, ListItem, Text as NativeText, RNHostView } from "@expo/ui";
import { router } from "expo-router";
import { Text, View } from "react-native";

export function MoreScreen() {
  const { bootstrap } = useSession();
  const theme = useTheme();
  const caps = bootstrap?.activeWorkspace?.capabilities ?? [];
  const work = [
    { label: "hAI assistant", href: "/assistant" },
    { label: "Search", href: "/search" },
    { label: "Files", href: listHref("files") },
    { label: "Activity", href: listHref("activity") },
    { label: "Notifications", href: listHref("notifications") },
    ...(caps.includes("view:audit") ? [{ label: "Audit trail", href: listHref("audit") }] : []),
    ...(caps.includes("view:member") || caps.includes("manage:member")
      ? [{ label: "Team", href: listHref("members") }]
      : []),
  ];
  const settings = [
    { label: "My account", href: "/profile" },
    { label: "Business settings", href: listHref("settings") },
    { label: "Workspaces", href: "/workspaces" },
    { label: "Subscription and billing", href: "/billing" },
    { label: "Device and privacy", href: "/feature/device" },
    { label: "Offline drafts", href: "/feature/drafts" },
    { label: "Privacy, terms and account deletion", href: "/legal" },
  ];
  return (
    <Host seedColor={theme.accent} style={{ flex: 1 }}>
      <View
        style={{
          margin: spacing.md,
          marginBottom: spacing.xs,
          padding: spacing.md,
          borderRadius: radius.md,
          borderCurve: "continuous",
          backgroundColor: theme.surface,
          borderColor: theme.line,
          borderWidth: 1,
          gap: spacing.xs,
        }}
      >
        <Text style={[typography.headline, { color: theme.text }]}>
          {bootstrap?.activeWorkspace?.name ?? "Workspace"}
        </Text>
        <Text style={[typography.caption, { color: theme.muted }]}>
          {bootstrap?.user.fullName ?? "User"} · Role:{" "}
          {bootstrap?.activeWorkspace?.role ?? "member"}
        </Text>
      </View>
      <FieldGroup>
        <FieldGroup.Section title="Your business">
          {work.map((item) => (
            <ListItem key={item.href} onPress={() => router.push(item.href as never)}>
              <NativeText>{item.label}</NativeText>
            </ListItem>
          ))}
        </FieldGroup.Section>
        <FieldGroup.Section title="Settings">
          {settings.map((item) => (
            <ListItem key={item.href} onPress={() => router.push(item.href as never)}>
              <NativeText>{item.label}</NativeText>
            </ListItem>
          ))}
        </FieldGroup.Section>
        <FieldGroup.Section>
          <RNHostView matchContents>
            <SignOutButton />
          </RNHostView>
        </FieldGroup.Section>
      </FieldGroup>
    </Host>
  );
}
