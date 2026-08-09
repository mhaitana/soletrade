import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rate-limit boundary tests for the auth actions. No network, no DB. Mocks
 * `next/headers` (so `getClientIp` returns a stable IP) and the Supabase server
 * client (so the happy path doesn't hit a real Supabase). The rate-limit check
 * runs BEFORE the Supabase call, so an exhausted limit returns the throttle
 * error without ever calling Supabase.
 */

const mockHeaders = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => mockHeaders(),
}));

const signInWithPassword = vi.fn();
const signInWithOtp = vi.fn();
const signUp = vi.fn();
vi.mock("@/shared/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: { signInWithPassword, signInWithOtp, signUp },
  }),
}));

import { clearRateLimits } from "@/server/rate-limit";
import { signInWithOtpAction, signInWithPasswordAction, signUpAction } from "./actions";

const THROTTLED = "Too many attempts. Please try again shortly.";

function setIp(ip: string): void {
  mockHeaders.mockResolvedValue({
    get: (name: string) => (name === "x-forwarded-for" ? ip : null),
  });
}

describe("auth action rate limits", () => {
  beforeEach(() => {
    clearRateLimits();
    signInWithPassword.mockReset();
    signInWithOtp.mockReset();
    signUp.mockReset();
    // Default: every Supabase call "fails" with an invalid-credentials error. The
    // rate-limit check runs first, so for the over-the-limit cases Supabase is
    // never reached; for the under-the-limit cases the action surfaces this error,
    // which is fine - we only assert on the rate-limit outcome.
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid credentials" } });
    signInWithOtp.mockResolvedValue({ error: null });
    signUp.mockResolvedValue({ data: { session: null, user: null }, error: null });
  });

  afterEach(() => {
    clearRateLimits();
  });

  describe("signInWithPasswordAction", () => {
    it("allows up to 10 attempts per IP per window then throttles the 11th", async () => {
      setIp("203.0.113.10");
      const input = { email: "user@example.com", password: "password" };
      for (let i = 0; i < 10; i++) {
        const res = await signInWithPasswordAction(input);
        expect(res.ok).toBe(false); // invalid credentials (Supabase mock), not throttled
        expect(res.ok === false && res.error).not.toBe(THROTTLED);
      }
      const res = await signInWithPasswordAction(input);
      expect(res.ok).toBe(false);
      expect(res.ok === false && res.error).toBe(THROTTLED);
      // Supabase was hit exactly 10 times - the 11th was blocked before the call.
      expect(signInWithPassword).toHaveBeenCalledTimes(10);
    });

    it("throttles by email across IPs (per-email limit)", async () => {
      // 10 attempts from 10 different IPs but the SAME email → email-key limit (10)
      // trips on the 11th even though each IP is under its own limit.
      const email = "target@example.com";
      for (let i = 0; i < 10; i++) {
        setIp(`198.51.100.${i}`);
        const res = await signInWithPasswordAction({ email, password: "password" });
        expect(res.ok === false && res.error).not.toBe(THROTTLED);
      }
      // 11th, from a fresh IP, same email → email limit trips.
      setIp("198.51.100.100");
      const res = await signInWithPasswordAction({ email, password: "password" });
      expect(res.ok === false && res.error).toBe(THROTTLED);
    });

    it("isolates limits per IP", async () => {
      // IP A exhausts its 10; IP B is still allowed.
      setIp("203.0.113.20");
      for (let i = 0; i < 10; i++) {
        await signInWithPasswordAction({ email: `a${i}@example.com`, password: "password" });
      }
      setIp("203.0.113.21");
      const res = await signInWithPasswordAction({ email: "b@example.com", password: "password" });
      expect(res.ok === false && res.error).not.toBe(THROTTLED);
    });
  });

  describe("signUpAction", () => {
    it("carries the selected modules, interval, and promotion through email verification", async () => {
      setIp("203.0.113.29");
      const res = await signUpAction({
        email: "linked@example.com",
        password: "password123",
        moduleKeys: ["books", "quotes"],
        interval: "annual",
        promotionCode: "launch25",
      });

      expect(res.ok).toBe(true);
      const options = signUp.mock.calls[0]?.[0]?.options;
      const callback = new URL(options.emailRedirectTo);
      expect(callback.pathname).toBe("/auth/callback");
      expect(callback.searchParams.get("next")).toBe(
        "/onboarding?modules=books%2Cquotes&interval=annual&promo=LAUNCH25",
      );
    });

    it("allows 5 per IP then throttles the 6th", async () => {
      setIp("203.0.113.30");
      for (let i = 0; i < 5; i++) {
        const res = await signUpAction({ email: `u${i}@example.com`, password: "password123" });
        expect(res.ok === false || res.ok === true).toBe(true);
        expect(res.ok === false && res.error).not.toBe(THROTTLED);
      }
      const res = await signUpAction({ email: "u5@example.com", password: "password123" });
      expect(res.ok === false && res.error).toBe(THROTTLED);
      expect(signUp).toHaveBeenCalledTimes(5);
    });
  });

  describe("signInWithOtpAction", () => {
    it("preserves signup intent in a magic-link callback", async () => {
      setIp("203.0.113.39");
      const res = await signInWithOtpAction({
        email: "magic@example.com",
        mode: "signup",
        moduleKeys: ["drive", "invoices"],
        interval: "monthly",
        promotionCode: "DRIVE-20",
      });

      expect(res.ok).toBe(true);
      const options = signInWithOtp.mock.calls[0]?.[0]?.options;
      const callback = new URL(options.emailRedirectTo);
      expect(options.shouldCreateUser).toBe(true);
      expect(callback.searchParams.get("next")).toBe(
        "/onboarding?modules=invoices%2Cdrive&interval=monthly&promo=DRIVE-20",
      );
    });

    it("allows 5 per IP then throttles the 6th", async () => {
      setIp("203.0.113.40");
      for (let i = 0; i < 5; i++) {
        const res = await signInWithOtpAction({ email: `o${i}@example.com`, mode: "signin" });
        expect(res.ok === false && res.error).not.toBe(THROTTLED);
      }
      const res = await signInWithOtpAction({ email: "o5@example.com", mode: "signin" });
      expect(res.ok === false && res.error).toBe(THROTTLED);
      expect(signInWithOtp).toHaveBeenCalledTimes(5);
    });

    it("throttles by email across IPs (per-email OTP limit)", async () => {
      const email = "otarget@example.com";
      for (let i = 0; i < 5; i++) {
        setIp(`198.51.200.${i}`);
        const res = await signInWithOtpAction({ email, mode: "signin" });
        expect(res.ok === false && res.error).not.toBe(THROTTLED);
      }
      setIp("198.51.200.100");
      const res = await signInWithOtpAction({ email, mode: "signin" });
      expect(res.ok === false && res.error).toBe(THROTTLED);
    });
  });
});
