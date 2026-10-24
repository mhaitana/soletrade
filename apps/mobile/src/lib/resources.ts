import { authoritativeDenial } from "@/lib/access-denial";
import { ApiError, subscribeApiFailures } from "@/lib/api";
import { cacheReference, clearWorkspaceReferences, readReference } from "@/lib/offline/store";
import { useSession } from "@/lib/session";
import { useCallback, useEffect, useRef, useState } from "react";

export type Entity = { id: string; updatedAt?: string; [key: string]: unknown };
export function useResource<T>(path: string | null) {
  const { request, userId, workspaceId, refreshBootstrap } = useSession();
  const [state, setState] = useState<{
    data?: T;
    loading: boolean;
    error?: string;
    cached?: boolean;
    denied?: boolean;
    syncedAt?: number;
  }>({ loading: true });
  const revision = useRef(0);
  const denialHandled = useRef(false);
  const accessBlocked = useRef(false);
  const deny = useCallback(
    async (message: string) => {
      if (denialHandled.current) return;
      denialHandled.current = true;
      accessBlocked.current = true;
      revision.current++;
      setState({ loading: false, error: message, denied: true });
      if (workspaceId) await clearWorkspaceReferences({ userId, workspaceId });
      void refreshBootstrap().catch(() => undefined);
    },
    [userId, workspaceId, refreshBootstrap],
  );
  const refresh = useCallback(
    async (overridePath?: string) => {
      const requestedPath = overridePath ?? path;
      const current = ++revision.current;
      denialHandled.current = false;
      if (!requestedPath || !userId) {
        setState({ loading: false });
        return;
      }
      setState((previous) => ({ ...previous, loading: true, error: undefined }));
      try {
        const data = await request<T>(requestedPath);
        if (current !== revision.current) return;
        accessBlocked.current = false;
        setState({ data, loading: false, cached: false, syncedAt: Date.now() });
        if (workspaceId) await cacheReference({ userId, workspaceId }, requestedPath, data);
      } catch (cause) {
        if (cause instanceof ApiError && authoritativeDenial(cause.detail.code, cause.status)) {
          await deny(cause.message);
          return;
        }
        if (
          cause instanceof ApiError &&
          cause.status > 0 &&
          cause.status < 500 &&
          ![408, 429].includes(cause.status)
        ) {
          if (current === revision.current) setState({ loading: false, error: cause.message });
          return;
        }
        if (accessBlocked.current) {
          setState({
            loading: false,
            error: cause instanceof Error ? cause.message : "This resource is unavailable.",
            denied: true,
          });
          return;
        }
        const saved = workspaceId
          ? await readReference<T>({ userId, workspaceId }, requestedPath).catch(() => null)
          : null;
        if (current === revision.current)
          setState((previous) => ({
            data: previous.data ?? saved?.data ?? undefined,
            loading: false,
            error: cause instanceof Error ? cause.message : "Could not load this page.",
            cached: !!(previous.data ?? saved),
            syncedAt: previous.data !== undefined ? previous.syncedAt : saved?.syncedAt,
          }));
      }
    },
    [path, request, userId, workspaceId, deny],
  );
  useEffect(
    () =>
      subscribeApiFailures((failure) => {
        if (
          authoritativeDenial(failure.error.code, failure.status) &&
          (failure.error.code.toLowerCase() === "account_closed" ||
            failure.path.startsWith(`/workspaces/${workspaceId}/`))
        )
          void deny(failure.error.message);
      }),
    [workspaceId, deny],
  );
  useEffect(() => {
    setState((previous) => ({
      loading: true,
      denied: previous.denied,
      error: previous.denied ? previous.error : undefined,
    }));
    void refresh();
    return () => {
      // Request-generation counter; invalidate every completion from the old binding.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      revision.current++;
    };
  }, [refresh]);
  return { ...state, refresh };
}
export function useWorkspacePath(resource: string) {
  const { workspaceId } = useSession();
  return workspaceId ? `/workspaces/${workspaceId}/${resource}` : null;
}
export function listHref(resource: string) {
  return `/resource/${encodeURIComponent(resource)}`;
}
export function detailHref(resource: string, id: string) {
  return `${listHref(resource)}/${id}`;
}
export function editHref(resource: string, id = "new") {
  return `/edit/${encodeURIComponent(resource)}/${id}`;
}
