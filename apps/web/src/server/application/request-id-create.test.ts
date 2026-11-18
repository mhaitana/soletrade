// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createWithRequestId } from "@/server/application/request-id-create";

vi.mock("server-only", () => ({}));

const REQUEST_ID = "00000000-0000-4000-8000-0000000000e1";

describe("createWithRequestId", () => {
  it("creates under the draft's id without any lookup", async () => {
    const create = vi.fn().mockResolvedValue(REQUEST_ID);
    const exists = vi.fn();
    await expect(createWithRequestId(REQUEST_ID, create, exists)).resolves.toEqual({
      id: REQUEST_ID,
      replayed: false,
    });
    expect(create).toHaveBeenCalledWith(REQUEST_ID);
    expect(exists).not.toHaveBeenCalled();
  });

  it("returns the existing record when a retried save already went through", async () => {
    const create = vi.fn().mockRejectedValue(new Error("duplicate key value"));
    const exists = vi.fn().mockResolvedValue(true);
    await expect(createWithRequestId(REQUEST_ID, create, exists)).resolves.toEqual({
      id: REQUEST_ID,
      replayed: true,
    });
    expect(exists).toHaveBeenCalledWith(REQUEST_ID);
  });

  it("reports the original failure when no record has that id in the workspace", async () => {
    const failure = new Error("customer not in workspace");
    const exists = vi.fn().mockResolvedValue(false);
    await expect(
      createWithRequestId(REQUEST_ID, vi.fn().mockRejectedValue(failure), exists),
    ).rejects.toBe(failure);
  });

  it("reports the original failure when the lookup itself fails", async () => {
    const failure = new Error("database unavailable");
    const exists = vi.fn().mockRejectedValue(new Error("lookup failed"));
    await expect(
      createWithRequestId(REQUEST_ID, vi.fn().mockRejectedValue(failure), exists),
    ).rejects.toBe(failure);
  });

  it("keeps the old behaviour when the form sends no id", async () => {
    const failure = new Error("boom");
    const create = vi.fn().mockRejectedValue(failure);
    const exists = vi.fn();
    await expect(createWithRequestId(undefined, create, exists)).rejects.toBe(failure);
    expect(create).toHaveBeenCalledWith(undefined);
    expect(exists).not.toHaveBeenCalled();
  });
});
