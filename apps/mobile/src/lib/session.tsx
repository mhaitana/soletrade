import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import type { Session } from "@supabase/supabase-js";
import type { MobileBootstrap, MobileRequest } from "@soletrade/contracts";
import { ApiError, createRequest, subscribeApiFailures } from "./api";
import { supabase } from "./supabase";
import "@/native/shift";
import { useNativeRuntime } from "@/native/runtime";
import { purgeClosedAccountLocally } from "./account-cleanup";
import { authoritativeDenial } from "./access-denial";
import { cacheReference, readReference } from "@/offline/store";

type SessionState = {
  session: Session | null;
  userId: string;
  workspaceId: string;
  bootstrap: MobileBootstrap | null;
  request: MobileRequest;
  refreshBootstrap: (workspaceId?: string) => Promise<MobileBootstrap | null>;
  ready: boolean;
  error: string | null;
  signOut: () => Promise<void>;
  closeAccount: () => Promise<void>;
};
const Context = createContext<SessionState | null>(null);
export async function token() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error("Sign in to continue.");
  if ((data.session.expires_at ?? 0) < Date.now() / 1000 + 60) {
    const result = await supabase.auth.refreshSession();
    if (result.error || !result.data.session)
      throw result.error ?? new Error("Your session expired. Sign in again.");
    return result.data.session.access_token;
  }
  return data.session.access_token;
}
export const mobileRequest = createRequest(token);
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [bootstrap, setBootstrap] = useState<MobileBootstrap | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const selected = useRef<string>("");
  const account = useRef<string>("");
  const closingAccount = useRef(false);
  const refreshBootstrap = useCallback(async (workspaceId?: string) => {
    const sequence = ++generation.current;
    const activeId = workspaceId ?? selected.current;
    try {
      const data = await mobileRequest<MobileBootstrap>(
        `/bootstrap${activeId ? `?workspaceId=${encodeURIComponent(activeId)}` : ""}`,
      );
      if (sequence !== generation.current) return null;
      selected.current = data.activeWorkspace?.id ?? "";
      setBootstrap(data);
      setError(null);
      const current = await supabase.auth.getUser();
      if (
        sequence !== generation.current ||
        account.current !== data.user.id ||
        current.data.user?.id !== data.user.id
      )
        return null;
      if (current.data.user) {
        await SecureStore.setItemAsync(`workspace.${current.data.user.id}`, selected.current);
        if (selected.current)
          await cacheReference(
            { userId: current.data.user.id, workspaceId: selected.current },
            "bootstrap",
            data,
          );
      }
      return sequence === generation.current && account.current === data.user.id ? data : null;
    } catch (cause) {
      if (sequence === generation.current) {
        const current = await supabase.auth.getSession();
        if (
          !(cause instanceof ApiError && authoritativeDenial(cause.detail.code, cause.status)) &&
          current.data.session?.user.id &&
          activeId
        ) {
          const cached = await readReference<MobileBootstrap>(
            { userId: current.data.session.user.id, workspaceId: activeId },
            "bootstrap",
          ).catch(() => null);
          if (
            cached &&
            sequence === generation.current &&
            cached.data.user.id === current.data.session.user.id
          )
            setBootstrap(cached.data);
        }
        setError(cause instanceof Error ? cause.message : "Could not load your workspace.");
      }
      return null;
    }
  }, []);
  const closeAccount = useCallback(async () => {
    if (closingAccount.current) return;
    const userId = account.current;
    generation.current++;
    setSession(null);
    setBootstrap(null);
    selected.current = "";
    account.current = "";
    closingAccount.current = true;
    await purgeClosedAccountLocally(userId);
  }, []);
  useEffect(
    () =>
      subscribeApiFailures(({ path, error }) => {
        if (error.code === "ACCOUNT_CLOSED") {
          setError(error.message);
          void closeAccount().catch(() => undefined);
        } else if (error.code === "WORKSPACE_UNAVAILABLE") {
          const workspaceId = path.match(/^\/workspaces\/([^/]+)/)?.[1] ?? selected.current;
          if (workspaceId === selected.current) {
            generation.current++;
            setBootstrap(null);
            selected.current = "";
            setError(error.message);
            void import("@/native/widgets").then((widgets) => widgets.clearWidgets());
            void import("@/offline/store").then((store) =>
              store.clearWorkspaceReferences({ userId: account.current, workspaceId }),
            );
          }
        }
      }),
    [closeAccount],
  );
  useEffect(() => {
    let alive = true;
    const activate = async (next: Session | null) => {
      if (!alive || (closingAccount.current && next)) return;
      if (!next) closingAccount.current = false;
      if (account.current !== (next?.user.id ?? "")) setBootstrap(null);
      account.current = next?.user.id ?? "";
      setSession(next);
      if (next) {
        selected.current = (await SecureStore.getItemAsync(`workspace.${next.user.id}`)) ?? "";
        await refreshBootstrap();
      } else {
        generation.current++;
        selected.current = "";
        setBootstrap(null);
        setError(null);
      }
      if (alive) setReady(true);
    };
    supabase.auth
      .getSession()
      .then(({ data }) => activate(data.session))
      .catch((cause) => {
        setError(String(cause));
        setReady(true);
      });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setTimeout(() => void activate(next), 0);
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    const callback = async (url: string) => {
      try {
        const parsed = new URL(url.replace("#", "?"));
        const code = parsed.searchParams.get("code");
        const hash = parsed.searchParams.get("token_hash");
        const linkError =
          parsed.searchParams.get("error_description") ?? parsed.searchParams.get("error");
        if (linkError) throw new Error(linkError);
        if (code) {
          const result = await supabase.auth.exchangeCodeForSession(code);
          if (result.error) throw result.error;
        } else if (hash) {
          const result = await supabase.auth.verifyOtp({ token_hash: hash, type: "email" });
          if (result.error) throw result.error;
        } else if (
          parsed.searchParams.get("access_token") &&
          parsed.searchParams.get("refresh_token")
        ) {
          const result = await supabase.auth.setSession({
            access_token: parsed.searchParams.get("access_token")!,
            refresh_token: parsed.searchParams.get("refresh_token")!,
          });
          if (result.error) throw result.error;
        } else if (url.includes("auth/callback")) {
          throw new Error("This sign-in link is incomplete. Request a new email link.");
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not verify this sign-in link.");
      }
    };
    Linking.getInitialURL().then((url) => {
      if (url) void callback(url);
    });
    const links = Linking.addEventListener("url", ({ url }) => void callback(url));
    return () => {
      alive = false;
      data.subscription.unsubscribe();
      appState.remove();
      links.remove();
    };
  }, [refreshBootstrap]);
  const boundRequest = useMemo(
    () =>
      createRequest(async () => {
        const current = await supabase.auth.getSession();
        if (!session || current.data.session?.user.id !== session.user.id)
          throw new Error("Account changed. Return to the original account to sync this draft.");
        return token();
      }),
    [session],
  );
  useNativeRuntime({
    userId: session?.user.id ?? "",
    workspaceId: bootstrap?.activeWorkspace?.id ?? "",
    request: boundRequest,
  });
  const value = useMemo(
    () => ({
      session,
      userId: session?.user.id ?? "",
      workspaceId: bootstrap?.activeWorkspace?.id ?? "",
      bootstrap,
      request: boundRequest,
      refreshBootstrap,
      ready,
      error,
      closeAccount,
      signOut: async () => {
        const result = await supabase.auth.signOut();
        if (result.error) throw result.error;
      },
    }),
    [session, bootstrap, boundRequest, refreshBootstrap, ready, error, closeAccount],
  );
  return <Context value={value}>{children}</Context>;
}
export function useSession() {
  const value = React.use(Context);
  if (!value) throw new Error("SessionProvider is missing.");
  return value;
}
