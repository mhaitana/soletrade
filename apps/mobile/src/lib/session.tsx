import { createRequest } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { MobileBootstrap, MobileRequest } from "@soletrade/contracts";
import type { Session } from "@supabase/supabase-js";
import React, { createContext } from "react";
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
export const Context = createContext<SessionState | null>(null);
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
export function useSession() {
  const value = React.use(Context);
  if (!value) throw new Error("SessionProvider is missing.");
  return value;
}
