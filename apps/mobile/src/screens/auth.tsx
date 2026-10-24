import { useState } from "react";
import { Alert, View, Text } from "react-native";
import * as Linking from "expo-linking";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { Action, Copy, ErrorNotice, Field, Group, Loading, Row, Screen } from "@/components/ui";
import { useResource } from "@/lib/resources";
import type { CollectionPage, MobileWorkspace } from "@soletrade/contracts";
import { configured, supabase } from "@/lib/supabase";
import { internalDestination } from "@/lib/navigation-intent";
import { useSession } from "@/lib/session";
import { radius, spacing, typography, useTheme } from "@/theme";

export function SignInScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const destination = internalDestination(returnTo);
  const theme = useTheme();
  const [mode, setMode] = useState<"password" | "magic" | "signup">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const submit = async () => {
    if (busy) return;
    if (!configured) {
      setError("Configure the public API and Supabase values in apps/mobile/.env.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    if (mode !== "magic" && password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const redirectTo = Linking.createURL("auth/callback", {
        queryParams: returnTo ? { returnTo } : {},
      });
      const result =
        mode === "magic"
          ? await supabase.auth.signInWithOtp({
              email: email.trim(),
              options: { emailRedirectTo: redirectTo },
            })
          : mode === "signup"
            ? await supabase.auth.signUp({
                email: email.trim(),
                password,
                options: { emailRedirectTo: redirectTo, data: { full_name: fullName.trim() } },
              })
            : await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      if (mode === "magic" || (mode === "signup" && !result.data.session))
        setMessage("Check your email. Open the verification link on this device to continue.");
      else if (returnTo === "back") router.back();
      else router.replace(destination as never);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <View style={{ alignItems: "center", gap: spacing.xs, marginVertical: spacing.sm }}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: radius.md,
            borderCurve: "continuous",
            backgroundColor: theme.primary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: theme.primaryForeground,
              fontSize: 22,
              fontWeight: "900",
              letterSpacing: -0.5,
            }}
          >
            HB
          </Text>
        </View>
        <Text style={[typography.headline, { color: theme.text, marginTop: spacing.xs }]}>
          Soletrade
        </Text>
      </View>
      <Copy variant="hero">Your business,{"\n"}in your pocket.</Copy>
      <Copy muted>Invoices, money and the road ahead. Together in Soletrade.</Copy>
      <Group title={mode === "signup" ? "Create your account" : "Welcome back"}>
        {mode === "signup" && (
          <Field
            label="Your name"
            value={fullName}
            onChangeText={setFullName}
            autoComplete="name"
          />
        )}
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
        {mode !== "magic" && (
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
        )}
        {!!error && <ErrorNotice message={error} />}
        {!!message && <Copy>{message}</Copy>}
        <Action
          title={
            mode === "magic"
              ? "Email me a sign-in link"
              : mode === "signup"
                ? "Create account"
                : "Sign in"
          }
          busy={busy}
          onPress={() => void submit()}
        />
        <Action
          title={mode === "magic" ? "Use a password" : "Use an email link"}
          secondary
          onPress={() => {
            setMode(mode === "magic" ? "password" : "magic");
            setError("");
          }}
        />
        <Action
          title={mode === "signup" ? "I already have an account" : "Create an account"}
          secondary
          onPress={() => setMode(mode === "signup" ? "password" : "signup")}
        />
      </Group>
      <Copy variant="caption" muted>
        By creating an account you agree to the Soletrade terms and privacy policy.
      </Copy>
      <Action title="Privacy and terms" secondary onPress={() => router.push("/legal")} />
    </Screen>
  );
}
export function WorkspacesScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const destination = internalDestination(returnTo);
  const { bootstrap, refreshBootstrap, request } = useSession();
  const workspaceList = useResource<CollectionPage<MobileWorkspace>>("/workspaces");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [operationId] = useState(() => Crypto.randomUUID());
  const create = async () => {
    if (!name.trim()) {
      setError("Enter your business name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const workspace = await request<{ id?: string; workspaceId?: string }>("/workspaces", {
        method: "POST",
        body: { name: name.trim(), timezone: "Australia/Melbourne", defaultCurrency: "AUD" },
        idempotencyKey: operationId,
      });
      await refreshBootstrap(workspace.id ?? workspace.workspaceId);
      router.replace(destination as never);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create workspace.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <Copy variant="title">Choose your workspace</Copy>
      {(workspaceList.data?.items ?? bootstrap?.workspaces ?? []).map((workspace) => (
        <Row
          key={workspace.workspaceId}
          title={workspace.name}
          subtitle={workspace.role}
          onPress={() =>
            void refreshBootstrap(workspace.workspaceId).then(() =>
              router.replace(destination as never),
            )
          }
        />
      ))}
      <Group title="Start a business workspace">
        <Field label="Business name" value={name} onChangeText={setName} />
        {!!error && <ErrorNotice message={error} />}
        <Action title="Create workspace" busy={busy} onPress={() => void create()} />
      </Group>
    </Screen>
  );
}
export function AuthCallbackScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { ready, error, session } = useSession();
  return (
    <Screen>
      {error ? (
        <ErrorNotice message={error} />
      ) : !ready || !session ? (
        <>
          <Loading />
          <Copy>Verifying your email link…</Copy>
        </>
      ) : (
        <>
          <Copy>Your email is verified.</Copy>
          <Action
            title="Continue"
            onPress={() => {
              if (returnTo === "back") router.dismissTo("/legal");
              else router.replace(internalDestination(returnTo) as never);
            }}
          />
        </>
      )}
    </Screen>
  );
}
export function InviteScreen() {
  const { token: inviteToken } = useLocalSearchParams<{ token: string }>();
  const { request, session, refreshBootstrap } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accept = async () => {
    setBusy(true);
    try {
      const result = await request<{ workspaceId: string }>("/invitations/accept", {
        method: "POST",
        body: { token: inviteToken },
        idempotencyKey: Crypto.randomUUID(),
      });
      await refreshBootstrap(result.workspaceId);
      router.replace("/");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <Copy variant="title">Join your team</Copy>
      <Copy>Accept this invitation to access the shared business workspace.</Copy>
      {error && <ErrorNotice message={error} />}
      {session ? (
        <Action title="Accept invitation" busy={busy} onPress={() => void accept()} />
      ) : (
        <Action
          title="Sign in to accept"
          onPress={() =>
            router.push({ pathname: "/sign-in", params: { returnTo: `/invite/${inviteToken}` } })
          }
        />
      )}
    </Screen>
  );
}
export function SignOutButton() {
  const { signOut, userId, request } = useSession();
  const leave = async (disposition: "keep" | "discard") => {
    try {
      const [store, shift, device, widgets] = await Promise.all([
        import("@/offline/store"),
        import("@/native/shift"),
        import("@/native/device"),
        import("@/native/widgets"),
      ]);
      await shift.suspendShiftForLogout(userId);
      await store.logoutDisposition(userId, disposition);
      if (disposition === "discard") await shift.discardPrivateDeviceData(userId);
      await device.unregisterPush(request, userId);
      await widgets.clearWidgets();
      await (await import("@/native/shortcuts")).clearAppShortcuts();
      await signOut();
    } catch (error) {
      Alert.alert("Could not sign out", String(error));
    }
  };
  return (
    <Action
      title="Sign out"
      secondary
      onPress={() =>
        Alert.alert(
          "Keep unsynced drafts?",
          "Active shifts pause. Kept drafts remain private to this account on this device.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Discard device drafts",
              style: "destructive",
              onPress: () => void leave("discard"),
            },
            { text: "Keep drafts and sign out", onPress: () => void leave("keep") },
          ],
        )
      }
    />
  );
}
