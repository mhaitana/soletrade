import { authoritativeDenial } from "@/lib/access-denial";
import { ApiError, subscribeApiFailures } from "@/lib/api";
import { cacheReference, clearWorkspaceReferences, readReference } from "@/lib/offline/store";
import { useSession } from "@/lib/session";
import { useCallback, useEffect, useRef, useState } from "react";

export type Entity = { id: string; updatedAt?: string; [key: string]: unknown };
/**
 * Pending local-cache purges after an authoritative denial, keyed by binding. A hook that mounts
 * while the purge is still running waits for it before reading, so denied records are never
 * resurrected from the saved copy.
 */
const pendingDenialClears = new Map<string, Promise<void>>();
const bindingKey = (userId: string, workspaceId: string) => `${userId}:${workspaceId}`;
export function useResource<T>(path: string | null) {
  const { request, userId, workspaceId, refreshBootstrap } = useSession();
  const [state, setState] = useState<{
    data?: T;
    loading: boolean;
    /** A network request is in flight. A saved copy may be on screen meanwhile. */
    refreshing?: boolean;
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
      if (workspaceId) {
        const key = bindingKey(userId, workspaceId);
        const clearing = Promise.resolve(clearWorkspaceReferences({ userId, workspaceId }));
        const settled = clearing.then(
          () => undefined,
          () => undefined,
        );
        pendingDenialClears.set(key, settled);
        void settled.then(() => {
          if (pendingDenialClears.get(key) === settled) pendingDenialClears.delete(key);
        });
        await clearing;
      }
      void refreshBootstrap().catch(() => undefined);
    },
    [userId, workspaceId, refreshBootstrap],
  );
  const load = useCallback(
    async (requestedPath: string | null | undefined, cacheFirst: boolean) => {
      const current = ++revision.current;
      denialHandled.current = false;
      if (!requestedPath || !userId) {
        setState({ loading: false });
        return;
      }
      setState((previous) => ({
        ...previous,
        loading: true,
        refreshing: true,
        error: undefined,
      }));
      let settled = false;
      if (cacheFirst && workspaceId && !accessBlocked.current) {
        // Show the saved copy for this exact user/workspace/path while the network refresh runs.
        const binding = { userId, workspaceId };
        void (async () => {
          await pendingDenialClears.get(bindingKey(userId, workspaceId));
          const saved = await readReference<T>(binding, requestedPath).catch(() => null);
          if (!saved || settled || current !== revision.current || accessBlocked.current) return;
          setState((previous) =>
            previous.data !== undefined || previous.denied
              ? previous
              : {
                  ...previous,
                  data: saved.data,
                  cached: true,
                  syncedAt: saved.syncedAt,
                  loading: false,
                  refreshing: true,
                },
          );
        })();
      }
      try {
        const data = await request<T>(requestedPath);
        settled = true;
        if (current !== revision.current) return;
        accessBlocked.current = false;
        setState({ data, loading: false, refreshing: false, cached: false, syncedAt: Date.now() });
        if (workspaceId) await cacheReference({ userId, workspaceId }, requestedPath, data);
      } catch (cause) {
        settled = true;
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
          if (current === revision.current)
            setState({ loading: false, refreshing: false, error: cause.message });
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
            refreshing: false,
            error: cause instanceof Error ? cause.message : "Could not load this page.",
            cached: !!(previous.data ?? saved),
            syncedAt: previous.data !== undefined ? previous.syncedAt : saved?.syncedAt,
          }));
      }
    },
    [request, userId, workspaceId, deny],
  );
  const refresh = useCallback(
    (overridePath?: string) => load(overridePath ?? path, false),
    [load, path],
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
      refreshing: true,
      denied: previous.denied,
      error: previous.denied ? previous.error : undefined,
    }));
    void load(path, true);
    return () => {
      // Request-generation counter; invalidate every completion from the old binding.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      revision.current++;
    };
  }, [load, path]);
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
