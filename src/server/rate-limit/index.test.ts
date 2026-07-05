import { afterEach, describe, expect, it } from "vitest";
import { clearRateLimits, rateLimit } from "./index";

afterEach(() => clearRateLimits());

describe("rate-limit", () => {
  it("allows up to max requests within the window", () => {
    expect(rateLimit("ip-1", { max: 3, windowMs: 1000 })).toBe(true);
    expect(rateLimit("ip-1", { max: 3, windowMs: 1000 })).toBe(true);
    expect(rateLimit("ip-1", { max: 3, windowMs: 1000 })).toBe(true);
    expect(rateLimit("ip-1", { max: 3, windowMs: 1000 })).toBe(false);
  });

  it("rejects the (max+1)th request in the window", () => {
    for (let i = 0; i < 5; i++) rateLimit("ip-2", { max: 5, windowMs: 1000 });
    expect(rateLimit("ip-2", { max: 5, windowMs: 1000 })).toBe(false);
  });

  it("resets the window after windowMs elapses", async () => {
    expect(rateLimit("ip-3", { max: 2, windowMs: 50 })).toBe(true);
    expect(rateLimit("ip-3", { max: 2, windowMs: 50 })).toBe(true);
    expect(rateLimit("ip-3", { max: 2, windowMs: 50 })).toBe(false);
    // Wait for the window to expire. (vitest has fake timers; a real wait keeps the
    // test honest about the expiry math.)
    await new Promise((r) => setTimeout(r, 60));
    expect(rateLimit("ip-3", { max: 2, windowMs: 50 })).toBe(true);
  });

  it("tracks keys independently", () => {
    expect(rateLimit("a", { max: 1, windowMs: 1000 })).toBe(true);
    expect(rateLimit("b", { max: 1, windowMs: 1000 })).toBe(true);
    expect(rateLimit("a", { max: 1, windowMs: 1000 })).toBe(false);
    expect(rateLimit("b", { max: 1, windowMs: 1000 })).toBe(false);
  });
});
