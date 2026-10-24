import "server-only";
import { cookies } from "next/headers";
import { branded, type WorkspaceId } from "@/types/ids";
import { env } from "@/server/infrastructure/config/env";

export const ACTIVE_WORKSPACE_COOKIE = "soletrade:wid";

export async function getActiveWorkspaceId(): Promise<WorkspaceId | null> {
  const store = await cookies();
  const value = store.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  return value ? branded<"WorkspaceId">(value) : null;
}

export async function setActiveWorkspaceId(id: WorkspaceId): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_WORKSPACE_COOKIE, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
}
