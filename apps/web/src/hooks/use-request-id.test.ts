import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { z } from "zod";
import { newRequestId, useRequestId } from "@/hooks/use-request-id";

const isUuid = (value: string) => z.string().uuid().safeParse(value).success;

describe("request ids", () => {
  it("produces ids the server schema accepts", () => {
    expect(isUuid(newRequestId())).toBe(true);
  });

  it("falls back when randomUUID is unavailable on a non-secure page", () => {
    // Shadow the method the way a non-secure page lacks it; deleting restores it.
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const ids = new Set(Array.from({ length: 50 }, () => newRequestId()));
      expect(ids.size).toBe(50);
      for (const id of ids) {
        expect(isUuid(id)).toBe(true);
        expect(id[14]).toBe("4");
      }
    } finally {
      delete (crypto as { randomUUID?: unknown }).randomUUID;
    }
  });

  it("keeps one id across renders and changes it only on renew", () => {
    const { result, rerender } = renderHook(() => useRequestId());
    const first = result.current.requestId;
    rerender();
    expect(result.current.requestId).toBe(first);
    act(() => result.current.renew());
    expect(result.current.requestId).not.toBe(first);
  });
});
