import { AppShell } from "@/application/layouts/app-shell";
import { SessionProvider } from "@/application/providers/session";
import { Stack } from "expo-router/stack";
export default function RootLayout() {
  return (
    <SessionProvider>
      <AppShell>
        <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ title: "Welcome", headerShown: false }} />
          <Stack.Screen
            name="edit/[resource]/[id]"
            options={{ title: "Edit record", presentation: "modal" }}
          />
          <Stack.Screen name="assistant" options={{ title: "hAI" }} />
          <Stack.Screen name="search" options={{ title: "Search" }} />
          <Stack.Screen name="feature/[name]" options={{ title: "Soletrade" }} />
          <Stack.Screen name="workspaces" options={{ title: "Workspaces" }} />
          <Stack.Screen name="resource/[resource]/index" options={{ title: "Records" }} />
          <Stack.Screen name="resource/[resource]/[id]" options={{ title: "Details" }} />
          <Stack.Screen name="reports" options={{ title: "Reports" }} />
          <Stack.Screen name="tax" options={{ title: "GST and BAS" }} />
          <Stack.Screen name="legal" options={{ title: "Privacy and account" }} />
          <Stack.Screen name="billing" options={{ title: "Subscription" }} />
          <Stack.Screen name="auth/callback" options={{ title: "Verify email" }} />
          <Stack.Screen name="invite/[token]" options={{ title: "Join your team" }} />
        </Stack>
      </AppShell>
    </SessionProvider>
  );
}
