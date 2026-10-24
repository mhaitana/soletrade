import { fetch } from "expo/fetch";
import * as Crypto from "expo-crypto";
import type { ApiErrorBody, MobileRequest, RequestOptions } from "@soletrade/contracts";

export const apiOrigin = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");
type FailureListener = (failure: { path: string; error: ApiErrorBody; status: number }) => void;
const failureListeners = new Set<FailureListener>();
export function subscribeApiFailures(listener: FailureListener) {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}
export class ApiError extends Error {
  constructor(
    public detail: ApiErrorBody,
    public status: number,
  ) {
    super(detail.message);
    this.name = "ApiError";
  }
}
export function apiUrl(path: string) {
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error("API path must begin with one slash.");
  if (!apiOrigin) throw new Error("Set EXPO_PUBLIC_API_URL before starting Soletrade.");
  return `${apiOrigin}/api/v1${path}`;
}
export async function authenticatedFetch(
  path: string,
  token: string,
  options: RequestOptions = {},
) {
  const operationId =
    options.idempotencyKey ??
    (options.method && options.method !== "GET" ? Crypto.randomUUID() : undefined);
  const body = options.body ?? (options.method && options.method !== "GET" ? {} : undefined);
  const response = await fetch(apiUrl(path), {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(operationId ? { "Idempotency-Key": operationId } : {}),
      ...(options.version ? { "If-Match": options.version } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response
      .clone()
      .json()
      .catch(() => null);
    if (payload?.error)
      for (const listener of failureListeners)
        listener({ path, error: payload.error, status: response.status });
  }
  return response;
}
export function createRequest(getToken: () => Promise<string>): MobileRequest {
  return async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
    const response = await authenticatedFetch(path, await getToken(), options);
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(
        payload?.error ?? {
          code: "REQUEST_FAILED",
          message: `Request failed (${response.status}). Please retry.`,
        },
        response.status,
      );
    if (!payload || !("data" in payload))
      throw new ApiError(
        { code: "INVALID_RESPONSE", message: "The server returned an unexpected response." },
        response.status,
      );
    return payload.data as T;
  };
}
