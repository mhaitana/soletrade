"use client";

import { useEffect, useActionState, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  signInWithOtpAction,
  signInWithPasswordAction,
  type AuthActionResult,
} from "@/app/(auth)/actions";

type Mode = "password" | "magic";

/**
 * Sign-in form with a password ⇄ magic-link toggle. The `next` param (passed by
 * the proxy when redirecting from a protected route) is forwarded to the
 * password action so a successful sign-in resumes the original destination.
 */
export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");

  const [state, action, pending] = useActionState(
    async (_prev: AuthActionResult | null, formData: FormData): Promise<AuthActionResult> => {
      const email = String(formData.get("email") ?? "");
      if (mode === "password") {
        const password = String(formData.get("password") ?? "");
        return signInWithPasswordAction({ email, password, next: next ?? undefined });
      }
      return signInWithOtpAction({ email, mode: "signin" });
    },
    null,
  );

  useEffect(() => {
    if (state?.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  const error = state && !state.ok ? state.error : "";
  const notice = state?.ok && state.message ? state.message : "";
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <div className="space-y-4">
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="text-sm text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}

      <form action={action} className="space-y-4">
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
            aria-describedby="email-error"
          />
          {fieldErrors?.email?.[0] ? (
            <p id="email-error" className="text-sm text-destructive">
              {fieldErrors.email[0]}
            </p>
          ) : null}
        </div>

        {mode === "password" ? (
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              aria-invalid={Boolean(fieldErrors?.password)}
              aria-describedby="password-error"
            />
            {fieldErrors?.password?.[0] ? (
              <p id="password-error" className="text-sm text-destructive">
                {fieldErrors.password[0]}
              </p>
            ) : null}
          </div>
        ) : null}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Working…" : mode === "password" ? "Sign in" : "Send sign-in link"}
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
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}
