"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/server/infrastructure/supabase/server";
import { env } from "@/server/infrastructure/config/env";
import { safeNext } from "@/lib/safe-redirect";
import { branded } from "@/types/ids";
import { ensureUserMirror } from "@/server/foundation/users/index";
import { rateLimit } from "@/server/infrastructure/rate-limit/index";
import { getClientIp } from "@/server/application/auth/authorization/index";
import { tryAdminContext } from "@/server/application/auth/admin-context";
import { MODULE_KEYS } from "@/config/modules";
import { onboardingPath } from "@/lib/domain/billing/signup-intent";

/** Throttle message used by every auth action when a rate limit is hit. */
const THROTTLED = "Too many attempts. Please try again shortly.";

/** Per-IP window for every auth action (60s, matching the public-page pattern). */
const WINDOW_MS = 60_000;

/**
 * Shared result union for the auth actions. On success the form reads
 * `redirectTo` (client-side `router.push`) and/or `checkEmail`/`message`
 * (inline notice). On failure `error` is shown at the top of the form and
 * optional `fieldErrors` per field.
 */
export type AuthActionResult =
  | { ok: true; redirectTo?: string; checkEmail?: boolean; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.");
const nextSchema = z.string().optional();

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
  next: nextSchema,
});

const signUpSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, "Password must be at least 8 characters."),
  fullName: z.string().trim().max(120, "Name is too long.").optional(),
  moduleKeys: z.array(z.enum(MODULE_KEYS)).min(1).default(["books"]),
  interval: z.enum(["monthly", "annual"]).default("monthly"),
  promotionCode: z.string().trim().max(100).optional(),
});

const otpSchema = z.object({
  email: emailSchema,
  mode: z.enum(["signin", "signup"]),
  moduleKeys: z.array(z.enum(MODULE_KEYS)).min(1).optional(),
  interval: z.enum(["monthly", "annual"]).optional(),
  promotionCode: z.string().trim().max(100).optional(),
});

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  return error.flatten().fieldErrors as Record<string, string[]>;
}

/** The PKCE email-link redirect target, derived from the app URL. */
function emailRedirectTo(next?: string): string {
  const url = new URL("/auth/callback", env.NEXT_PUBLIC_APP_URL);
  if (next) url.searchParams.set("next", next);
  return url.toString();
}

/**
 * Sign in with email + password. On success, the session cookies are set on
 * the response via the SSR client; the form then navigates to `next` (if a
 * safe same-origin path) or `/dashboard`.
 */
export async function signInWithPasswordAction(input: unknown): Promise<AuthActionResult> {
  // IP limit first - catches raw volume / distributed guessing before any work.
  const ip = await getClientIp();
  if (!(await rateLimit(`auth:signin:${ip}`, { max: 10, windowMs: WINDOW_MS }))) {
    return { ok: false, error: THROTTLED };
  }
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }
  const { email, password, next } = parsed.data;
  // Per-email limit - protects a single account from targeted credential stuffing
  // across many IPs.
  if (!(await rateLimit(`auth:signin-email:${email}`, { max: 10, windowMs: WINDOW_MS }))) {
    return { ok: false, error: THROTTLED };
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false, error: "Invalid email or password." };
  }
  const safeTarget = safeNext(next);
  if (safeTarget) {
    return { ok: true, redirectTo: safeTarget };
  }
  const adminCtx = await tryAdminContext();
  if (adminCtx && adminCtx.roles.includes("super_admin")) {
    return { ok: true, redirectTo: "/admin" };
  }
  return { ok: true, redirectTo: "/dashboard" };
}

/**
 * Sign up with email + password (+ optional full name). With local autoconfirm
 * (`enable_confirmations=false`) a session is returned immediately and the
 * public.users mirror is created; the form navigates to /onboarding. With email
 * confirmation on, no session is returned and the form shows a "check email"
 * notice.
 */
export async function signUpAction(input: unknown): Promise<AuthActionResult> {
  const ip = await getClientIp();
  if (!(await rateLimit(`auth:signup:${ip}`, { max: 5, windowMs: WINDOW_MS }))) {
    return { ok: false, error: THROTTLED };
  }
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }
  const { email, password, fullName, moduleKeys, interval, promotionCode } = parsed.data;
  const next = onboardingPath({ moduleKeys, interval, promotionCode });
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: fullName ? { full_name: fullName } : undefined,
      emailRedirectTo: emailRedirectTo(next),
    },
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  if (data.session && data.user) {
    // Autoconfirm path - mirror the auth user into public.users so workspace
    // creation's FK is satisfied.
    await ensureUserMirror({
      id: branded<"UserId">(data.user.id),
      email: data.user.email ?? email,
      fullName,
    });
    return { ok: true, redirectTo: next };
  }
  // Email-confirmation path - Supabase sent a verification link.
  return { ok: true, checkEmail: true };
}

/**
 * Send a magic-link sign-in / sign-up email. `mode: "signup"` allows creating a
 * new user if one doesn't exist; `"signin"` only signs in existing users. The
 * link click lands at /auth/callback, which exchanges the code and establishes
 * the session. No redirect here - the form shows a "check your email" notice.
 */
export async function signInWithOtpAction(input: unknown): Promise<AuthActionResult> {
  const ip = await getClientIp();
  if (!(await rateLimit(`auth:otp:${ip}`, { max: 5, windowMs: WINDOW_MS }))) {
    return { ok: false, error: THROTTLED };
  }
  const parsed = otpSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }
  const { email, mode, moduleKeys, interval, promotionCode } = parsed.data;
  if (!(await rateLimit(`auth:otp-email:${email}`, { max: 5, windowMs: WINDOW_MS }))) {
    return { ok: false, error: THROTTLED };
  }
  const supabase = createSupabaseServerClient();
  const next =
    mode === "signup"
      ? onboardingPath({
          moduleKeys: moduleKeys ?? ["books"],
          interval: interval ?? "monthly",
          promotionCode,
        })
      : undefined;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: mode === "signup",
      emailRedirectTo: emailRedirectTo(next),
    },
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return {
    ok: true,
    message:
      mode === "signup"
        ? "Check your email for a sign-up link."
        : "Check your email for a sign-in link.",
  };
}
