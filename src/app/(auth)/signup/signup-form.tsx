"use client";

import { useEffect, useActionState, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { signInWithOtpAction, signUpAction, type AuthActionResult } from "@/app/(auth)/actions";

type Mode = "password" | "magic";

/**
 * Sign-up form with a password ⇄ magic-link toggle. Password mode collects an
 * optional full name (mirrored to user_metadata.full_name + public.users) and a
 * password + confirmation. Magic-link mode sends a sign-up link that creates
 * the user on click.
 */
export function SignupForm({ initialCheckEmail = false }: { initialCheckEmail?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [showCheckEmail, setShowCheckEmail] = useState(initialCheckEmail);

  const [state, action, pending] = useActionState(
    async (_prev: AuthActionResult | null, formData: FormData): Promise<AuthActionResult> => {
      const email = String(formData.get("email") ?? "");
      if (mode === "password") {
        const password = String(formData.get("password") ?? "");
        const confirm = String(formData.get("confirm") ?? "");
        if (password !== confirm) {
          return { ok: false, error: "Passwords do not match." };
        }
        const fullName = String(formData.get("fullName") ?? "").trim();
        const result = await signUpAction({ email, password, fullName: fullName || undefined });
        if (result.ok && result.checkEmail) setShowCheckEmail(true);
        return result;
      }
      const result = await signInWithOtpAction({ email, mode: "signup" });
      if (result.ok && result.message) setShowCheckEmail(true);
      return result;
    },
    null,
  );

  useEffect(() => {
    if (state?.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  const error = state && !state.ok ? state.error : "";
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <div className="space-y-4">
      {showCheckEmail ? (
        <p className="text-sm text-muted-foreground" role="status">
          We&apos;ve sent you a sign-up link — check your email (locally, open{" "}
          <a
            href="http://127.0.0.1:54324"
            target="_blank"
            rel="noreferrer"
            className="underline-offset-4 hover:underline"
          >
            Inbucket
          </a>
          ) and click it to finish.
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <form action={action} className="space-y-4">
        {mode === "password" ? (
          <div className="space-y-1.5">
            <Label htmlFor="fullName">Full name (optional)</Label>
            <Input
              id="fullName"
              name="fullName"
              type="text"
              autoComplete="name"
              maxLength={120}
              placeholder="Jane Smith"
            />
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={Boolean(fieldErrors?.email)}
          />
          {fieldErrors?.email?.[0] ? (
            <p className="text-sm text-destructive">{fieldErrors.email[0]}</p>
          ) : null}
        </div>

        {mode === "password" ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                aria-invalid={Boolean(fieldErrors?.password)}
              />
              {fieldErrors?.password?.[0] ? (
                <p className="text-sm text-destructive">{fieldErrors.password[0]}</p>
              ) : (
                <p className="text-xs text-muted-foreground">At least 8 characters.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                name="confirm"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
          </>
        ) : null}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Working…" : mode === "password" ? "Create account" : "Send sign-up link"}
        </Button>
      </form>

      <div className="text-center">
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-sm"
          onClick={() => setMode((m) => (m === "password" ? "magic" : "password"))}
        >
          {mode === "password" ? "Use a magic link instead" : "Use a password instead"}
        </Button>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
