import { createRequest, subscribeApiFailures } from "@/lib/api";
import { fetch } from "expo/fetch";
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "a107a043-d769-4c46-b999-0705d7734134" }));
beforeEach(() => {
  jest.clearAllMocks();
});
it("sends bearer, stable idempotency and optimistic concurrency headers", async () => {
  jest
    .mocked(fetch)
    .mockResolvedValue({ ok: true, json: async () => ({ data: { id: "created" } }) } as Awaited<
      ReturnType<typeof fetch>
    >);
  const request = createRequest(async () => "user-token");
  await request("/workspaces/workspace/customers", {
    method: "PATCH",
    body: { name: "Mina" },
    version: "2026-10-25T00:00:00Z",
    idempotencyKey: "a107a043-d769-4c46-b999-0705d7734134",
  });
  expect(fetch).toHaveBeenCalledWith(
    "https://test.soletrade.example/api/v1/workspaces/workspace/customers",
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer user-token",
        "If-Match": "2026-10-25T00:00:00Z",
        "Idempotency-Key": "a107a043-d769-4c46-b999-0705d7734134",
      }),
    }),
  );
});
it("preserves typed stale-edit errors for the form and never retries financial writes", async () => {
  jest.mocked(fetch).mockResolvedValue({
    ok: false,
    status: 409,
    clone: () => ({ json: async () => ({ error: { code: "STALE_VERSION", message: "Changed" } }) }),
    json: async () => ({
      error: { code: "STALE_VERSION", message: "This record changed. Reload it before saving." },
    }),
  } as Awaited<ReturnType<typeof fetch>>);
  await expect(
    createRequest(async () => "token")("/workspaces/workspace/invoices/id/paid", {
      method: "POST",
      body: {},
    }),
  ).rejects.toMatchObject({ detail: { code: "STALE_VERSION" }, status: 409 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not issue a request when the session binding rejects a changed account", async () => {
  const request = createRequest(async () => {
    throw new Error("Account changed.");
  });
  await expect(request("/workspaces/old/customers", { method: "POST", body: {} })).rejects.toThrow(
    "Account changed.",
  );
  expect(fetch).not.toHaveBeenCalled();
});

it("broadcasts explicit account closure so private screens can purge before caching", async () => {
  const listener = jest.fn();
  const unsubscribe = subscribeApiFailures(listener);
  const payload = { error: { code: "ACCOUNT_CLOSED", message: "This account is closed." } };
  jest.mocked(fetch).mockResolvedValue({
    ok: false,
    status: 403,
    clone: () => ({ json: async () => payload }),
    json: async () => payload,
  } as Awaited<ReturnType<typeof fetch>>);
  await expect(createRequest(async () => "token")("/workspaces/w/customers")).rejects.toMatchObject(
    { status: 403 },
  );
  expect(listener).toHaveBeenCalledWith({
    path: "/workspaces/w/customers",
    status: 403,
    error: payload.error,
  });
  unsubscribe();
});
