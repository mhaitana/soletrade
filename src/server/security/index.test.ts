import { describe, expect, it, vi, beforeEach } from "vitest";

// `headers()` is request-scoped in Next; mock it so we can drive the IP precedence
// without a real request. Each test sets `mockHeaders` before calling `getClientIp`.
const mockHeaders = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => mockHeaders(),
}));

import { getClientIp } from "./index";

function setHeaders(map: Record<string, string | undefined>): void {
  mockHeaders.mockResolvedValue({
    get: (name: string) => map[name] ?? null,
  });
}

describe("getClientIp — IP header precedence", () => {
  beforeEach(() => {
    mockHeaders.mockReset();
  });

  it("uses the first x-forwarded-for entry (originating client)", async () => {
    setHeaders({ "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" });
    await expect(getClientIp()).resolves.toBe("203.0.113.5");
  });

  it("trims whitespace around the first x-forwarded-for entry", async () => {
    setHeaders({ "x-forwarded-for": "  203.0.113.5  , 10.0.0.1" });
    await expect(getClientIp()).resolves.toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    setHeaders({ "x-real-ip": "198.51.100.7" });
    await expect(getClientIp()).resolves.toBe("198.51.100.7");
  });

  it("prefers x-forwarded-for over x-real-ip when both are present", async () => {
    setHeaders({ "x-forwarded-for": "203.0.113.5", "x-real-ip": "198.51.100.7" });
    await expect(getClientIp()).resolves.toBe("203.0.113.5");
  });

  it("returns 'unknown' when no IP headers are present", async () => {
    setHeaders({});
    await expect(getClientIp()).resolves.toBe("unknown");
  });

  it("falls back to x-real-ip when x-forwarded-for is an empty string", async () => {
    setHeaders({ "x-forwarded-for": "", "x-real-ip": "198.51.100.7" });
    await expect(getClientIp()).resolves.toBe("198.51.100.7");
  });
});
