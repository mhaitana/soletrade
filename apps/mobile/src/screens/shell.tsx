import React, { useCallback, useEffect } from "react";
import {
  Redirect,
  router,
  useGlobalSearchParams,
  useLocalSearchParams,
  usePathname,
  useSegments,
} from "expo-router";
import { ThemeProvider, DarkTheme, DefaultTheme } from "expo-router/react-navigation";
import { useColorScheme } from "react-native";
import { AppLock, listenForPush, setDeviceNotificationPreferences } from "@/native/device";
import { clearWidgets } from "@/native/widgets";
import {
  ReceiptCaptureScreen,
  ShiftScreen,
  DraftsScreen,
  DeviceSettingsScreen,
  StorePurchaseScreen,
} from "@/native/screens";
import { Action, Copy, ErrorNotice, Loading, Screen } from "@/components/ui";
import { PrivateAppFrame } from "@/components/private-toolbar";
import { privateToolbarAllowed } from "@/lib/global-actions";
import { internalDestination } from "@/lib/navigation-intent";
import { useSession } from "@/lib/session";
import { useAppShortcuts } from "@/native/shortcuts";
import { navigateBusiness } from "./tools";
export function AppShell({ children }: { children: React.ReactNode }) {
  const { ready, session, bootstrap, error, refreshBootstrap, workspaceId, userId } = useSession();
  const openShortcut = useCallback((href: string) => router.push(href as never), []);
  useAppShortcuts({
    userId,
    workspaceId,
    modules: bootstrap?.activeWorkspace?.modules ?? [],
    open: openShortcut,
  });
  const segments = useSegments();
  const pathname = usePathname();
  const intentParams = useGlobalSearchParams<{
    workspaceId?: string;
    userId?: string;
    draftId?: string;
  }>();
  const requestedWorkspace =
    typeof intentParams.workspaceId === "string" ? intentParams.workspaceId : "";
  const requestedUser = typeof intentParams.userId === "string" ? intentParams.userId : "";
  const bindingQuery = new URLSearchParams();
  if (requestedWorkspace) bindingQuery.set("workspaceId", requestedWorkspace);
  if (requestedUser) bindingQuery.set("userId", requestedUser);
  if (typeof intentParams.draftId === "string") bindingQuery.set("draftId", intentParams.draftId);
  const pendingDestination = internalDestination(
    `${pathname}${bindingQuery.size ? `?${bindingQuery}` : ""}`,
  );
  const canSwitchToIntent = !!bootstrap?.workspaces.some(
    (workspace) => workspace.workspaceId === requestedWorkspace,
  );
  useEffect(() => {
    if (
      session &&
      bootstrap &&
      requestedWorkspace &&
      requestedWorkspace !== workspaceId &&
      canSwitchToIntent &&
      (!requestedUser || requestedUser === userId)
    )
      void refreshBootstrap(requestedWorkspace);
  }, [
    session,
    bootstrap,
    requestedWorkspace,
    workspaceId,
    canSwitchToIntent,
    requestedUser,
    userId,
    refreshBootstrap,
  ]);
  const dark = useColorScheme() === "dark";
  useEffect(() => {
    void clearWidgets().catch(() => undefined);
  }, [workspaceId, userId]);
  useEffect(() => {
    if (bootstrap) setDeviceNotificationPreferences(bootstrap.preferences);
  }, [bootstrap]);
  useEffect(
    () =>
      listenForPush((path, workspace) => {
        if (!userId) return;
        void refreshBootstrap(workspace).then((verified) => {
          if (
            !verified ||
            verified.user.id !== userId ||
            verified.activeWorkspace?.id !== workspace
          )
            return;
          if (/^\/(feature|resource|\(tabs\))\//.test(path) || path === "/legal") {
            const destination = internalDestination(path);
            router.push(
              `${destination}${destination.includes("?") ? "&" : "?"}workspaceId=${encodeURIComponent(workspace)}&userId=${encodeURIComponent(userId)}` as never,
            );
          } else navigateBusiness(path);
        });
      }),
    [refreshBootstrap, userId],
  );
  if (!ready) return <Loading />;
  const publicRoute = ["sign-in", "auth", "invite", "legal"].includes(String(segments[0]));
  if (!session && !publicRoute)
    return <Redirect href={{ pathname: "/sign-in", params: { returnTo: pendingDestination } }} />;
  if (session && !bootstrap && !publicRoute && segments[0] !== "workspaces")
    return (
      <Screen>
        {error ? (
          <ErrorNotice message={error} retry={() => void refreshBootstrap()} />
        ) : (
          <Loading />
        )}
        <Action
          title="Choose another workspace"
          secondary
          onPress={() => router.push("/workspaces")}
        />
        <Action title="Try sign in again" secondary onPress={() => router.push("/sign-in")} />
      </Screen>
    );
  if (session && bootstrap && !workspaceId && !publicRoute && segments[0] !== "workspaces")
    return (
      <Redirect href={{ pathname: "/workspaces", params: { returnTo: pendingDestination } }} />
    );
  if (session && bootstrap && requestedUser && requestedUser !== userId)
    return (
      <Screen>
        <ErrorNotice message="This shortcut belongs to another account. Sign in with the original account to continue." />
        <Action
          title="Use the original account"
          onPress={() =>
            router.push({ pathname: "/sign-in", params: { returnTo: pendingDestination } })
          }
        />
      </Screen>
    );
  if (session && bootstrap && requestedWorkspace && requestedWorkspace !== workspaceId)
    return (
      <Screen>
        {canSwitchToIntent ? (
          error ? (
            <ErrorNotice message={error} retry={() => void refreshBootstrap(requestedWorkspace)} />
          ) : (
            <Loading />
          )
        ) : (
          <>
            <ErrorNotice message="You no longer have access to the workspace for this link." />
            <Action title="Choose a workspace" onPress={() => router.push("/workspaces")} />
          </>
        )}
      </Screen>
    );
  const active = bootstrap?.activeWorkspace;
  const toolbar = privateToolbarAllowed({
    authenticated: !!session,
    pathname,
    userId,
    workspaceId,
    bootstrapUserId: bootstrap?.user.id,
    activeWorkspaceId: active?.id,
    requestedUser,
    requestedWorkspace,
  });
  return (
    <ThemeProvider value={dark ? DarkTheme : DefaultTheme}>
      {session ? (
        <AppLock key={`${userId}:${workspaceId}`} userId={userId}>
          {toolbar && active ? (
            <PrivateAppFrame
              workspaceName={active.name}
              pathname={pathname}
              modules={active.modules}
              capabilities={active.capabilities}
              onNavigate={openShortcut}
            >
              {children}
            </PrivateAppFrame>
          ) : (
            children
          )}
        </AppLock>
      ) : (
        children
      )}
    </ThemeProvider>
  );
}
export function FeatureScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const { userId, workspaceId, request, bootstrap, refreshBootstrap } = useSession();
  const modules = bootstrap?.activeWorkspace?.modules ?? [];
  const caps = bootstrap?.activeWorkspace?.capabilities ?? [];
  const features: Record<
    string,
    React.ComponentType<import("@soletrade/contracts").MobileFeatureProps>
  > = {
    receipt: ReceiptCaptureScreen,
    shift: ShiftScreen,
    drafts: DraftsScreen,
    device: DeviceSettingsScreen,
    store: StorePurchaseScreen,
  };
  const Feature = features[name];
  if (!Feature)
    return (
      <Screen>
        <Copy>This feature could not be found.</Copy>
      </Screen>
    );
  if (
    (name === "receipt" && (!modules.includes("books") || !caps.includes("manage:books"))) ||
    (name === "shift" && (!modules.includes("drive") || !caps.includes("create:drive")))
  )
    return (
      <Screen>
        <Copy>This feature requires an enabled module and permission to create its records.</Copy>
      </Screen>
    );
  return (
    <Feature
      key={`${userId}:${workspaceId}:${name}`}
      userId={userId}
      workspaceId={workspaceId}
      request={request}
      onSaved={() => void refreshBootstrap()}
    />
  );
}
