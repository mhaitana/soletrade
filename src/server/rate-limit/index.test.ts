import { afterEach, describe, expect, it } from "vitest";
import { clearRateLimits, rateLimit } from "./index";

afterEach(() => clearRateLimits());

// These tests run with UPSTASH_REDIS_REST_URL unset (no .env.local in CI), so
// `rateLimit` exercises the in-memory fixed-window fallback path. The Upstash
// path is a thin wrapper over @upstash/ratelimit and is verified in deployment.

describe("rate-limit (in-memory fallback)", () => {
  it("allows up to max requests within the window", async () => {
    expect(await rateLimit("ip-1", { max: 3, windowMs: 1000 })).toBe(true);
    expect(await rateLimit("ip-1", { max: 3, windowMs: 1000 })).toBe(true);
    expect(await rateLimit("ip-1", { max: 3, windowMs: 1000 })).toBe(true);
    expect(await rateLimit("ip-1", { max: 3, windowMs: 1000 })).toBe(false);
  });

  it("rejects the (max+1)th request in the window", async () => {
    for (let i = 0; i < 5; i++) await rateLimit("ip-2", { max: 5, windowMs: 1000 });
    expect(await rateLimit("ip-2", { max: 5, windowMs: 1000 })).toBe(false);
  });

  it("resets the window after windowMs elapses", async () => {
    expect(await rateLimit("ip-3", { max: 2, windowMs: 50 })).toBe(true);
    expect(await rateLimit("ip-3", { max: 2, windowMs: 50 })).toBe(true);
    expect(await rateLimit("ip-3", { max: 2, windowMs: 50 })).toBe(false);
    // Wait for the window to expire. (vitest has fake timers; a real wait keeps the
    // test honest about the expiry math.)
    await new Promise((r) => setTimeout(r, 60));
    expect(await rateLimit("ip-3", { max: 2, windowMs: 50 })).toBe(true);
  });

  it("tracks keys independently", async () => {
    expect(await rateLimit("a", { max: 1, windowMs: 1000 })).toBe(true);
    expect(await rateLimit("b", { max: 1, windowMs: 1000 })).toBe(true);
    expect(await rateLimit("a", { max: 1, windowMs: 1000 })).toBe(false);
    expect(await rateLimit("b", { max: 1, windowMs: 1000 })).toBe(false);
  });
});
