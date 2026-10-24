"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  MailCheck,
  Sparkles,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MODULES, type ModuleKey } from "@/config/modules";
import { formatCents, priceSubscription, type Interval } from "@/lib/domain/billing/pricing";
import type { SignupIntent } from "@/lib/domain/billing/signup-intent";
import {
  signInWithOtpAction,
  signUpAction,
  type AuthActionResult,
} from "@/features/auth/api/actions";
import { cn } from "@/lib/utils";

type Mode = "password" | "magic";
type MobileStep = "account" | "modules";

const DISPLAY_ORDER: ModuleKey[] = ["books", "quotes", "drive", "invoices"];

interface LinkedPromotion {
  code: string;
  label: string;
  discountType: "percentage" | "fixed_amount";
  percentOff?: number;
  amountOffCents?: number;
}

function discountedTotal(totalCents: number, promotion?: LinkedPromotion): number {
  if (!promotion) return totalCents;
  if (promotion.discountType === "percentage") {
    return Math.max(0, Math.round(totalCents * (1 - (promotion.percentOff ?? 0) / 100)));
  }
  return Math.max(0, totalCents - (promotion.amountOffCents ?? 0));
}

function PasswordInput({
  id,
  name,
  label,
  describedBy,
  invalid,
}: {
  id: string;
  name: string;
  label: string;
  describedBy?: string;
  invalid?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          required
          minLength={8}
          autoComplete="new-password"
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="pr-11"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute inset-y-0 right-0 grid w-11 cursor-pointer place-items-center rounded-r-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  );
}

/** Unified account + module selection. Workspace naming stays after email verification. */
export function SignupForm({
  intent,
  promotion,
  promotionUnavailable = false,
  initialCheckEmail = false,
}: {
  intent: SignupIntent;
  promotion?: LinkedPromotion;
  promotionUnavailable?: boolean;
  initialCheckEmail?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [showCheckEmail, setShowCheckEmail] = useState(initialCheckEmail);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [selected, setSelected] = useState<Set<ModuleKey>>(() => new Set(intent.moduleKeys));
  const [interval, setInterval] = useState<Interval>(intent.interval);
  const [mobileStep, setMobileStep] = useState<MobileStep>("account");
  const [passwordMismatch, setPasswordMismatch] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const accountHeadingRef = useRef<HTMLHeadingElement>(null);
  const modulesHeadingRef = useRef<HTMLHeadingElement>(null);
  const accountErrorRef = useRef<HTMLParagraphElement>(null);
  const passwordMismatchRef = useRef<HTMLParagraphElement>(null);
  const pendingStepFocus = useRef<MobileStep | null>(null);

  const selectedKeys = useMemo(() => DISPLAY_ORDER.filter((key) => selected.has(key)), [selected]);
  const pricing = priceSubscription(selectedKeys, interval);
  const suffix = interval === "monthly" ? "/mo" : "/yr";
  const promotionalTotal = discountedTotal(pricing.totalCents, promotion);

  function routeAuthResult(result: AuthActionResult): AuthActionResult {
    if (!result.ok) setMobileStep("account");
    return result;
  }

  const [state, action, pending] = useActionState(
    async (_prev: AuthActionResult | null, formData: FormData): Promise<AuthActionResult> => {
      const email = String(formData.get("email") ?? "");
      setSubmittedEmail(email);
      const signupIntent = {
        moduleKeys: selectedKeys,
        interval,
        promotionCode: promotion?.code,
      };
      if (mode === "password") {
        const password = String(formData.get("password") ?? "");
        const confirm = String(formData.get("confirm") ?? "");
        if (password !== confirm) {
          return routeAuthResult({ ok: false, error: "Passwords do not match." });
        }
        const fullName = String(formData.get("fullName") ?? "").trim();
        const result = await signUpAction({
          email,
          password,
          fullName: fullName || undefined,
          ...signupIntent,
        });
        if (result.ok && result.checkEmail) setShowCheckEmail(true);
        return routeAuthResult(result);
      }
      const result = await signInWithOtpAction({ email, mode: "signup", ...signupIntent });
      if (result.ok && result.message) setShowCheckEmail(true);
      return routeAuthResult(result);
    },
    null,
  );

  useEffect(() => {
    if (state?.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  useEffect(() => {
    if (state && !state.ok && mobileStep === "account") accountErrorRef.current?.focus();
  }, [mobileStep, state]);

  useEffect(() => {
    if (pendingStepFocus.current !== mobileStep) return;
    pendingStepFocus.current = null;
    const heading =
      mobileStep === "account" ? accountHeadingRef.current : modulesHeadingRef.current;
    heading?.focus({ preventScroll: true });
    formRef.current?.scrollIntoView?.({ block: "start" });
  }, [mobileStep]);

  useEffect(() => {
    if (passwordMismatch) passwordMismatchRef.current?.focus();
  }, [passwordMismatch]);

  function moveToStep(next: MobileStep) {
    pendingStepFocus.current = next;
    setMobileStep(next);
  }

  function advanceToModules() {
    const form = formRef.current;
    if (!form?.reportValidity()) return;
    if (mode === "password") {
      const data = new FormData(form);
      if (data.get("password") !== data.get("confirm")) {
        setPasswordMismatch(true);
        return;
      }
    }
    setPasswordMismatch(false);
    moveToStep("modules");
  }

  function toggleModule(key: ModuleKey) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (showCheckEmail) {
    return (
      <div className="px-6 py-12 text-center sm:px-10">
        <div className="mx-auto grid size-12 place-items-center rounded-full border border-success/30 bg-success/10 text-success">
          <MailCheck className="size-5" />
        </div>
        <h2 className="mt-5 text-xl font-semibold">Check your inbox</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          We sent a secure sign-up link{submittedEmail ? ` to ${submittedEmail}` : ""}. Open it to
          verify your email, then name your workspace and review payment.
        </p>
        {process.env.NODE_ENV === "development" ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Local email is available in{" "}
            <a
              href="http://127.0.0.1:54324"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand-blue underline-offset-4 hover:underline"
            >
              Inbucket
            </a>
            .
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="mt-6"
          onClick={() => setShowCheckEmail(false)}
        >
          Use a different email
        </Button>
      </div>
    );
  }

  const error = state && !state.ok ? state.error : "";
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form ref={formRef} action={action} className="min-w-0">
      <ol
        className="grid min-w-0 grid-cols-2 border-b border-border lg:hidden"
        aria-label="Signup progress"
      >
        {(["account", "modules"] as const).map((step, index) => (
          <li
            key={step}
            aria-current={mobileStep === step ? "step" : undefined}
            className={cn(
              "border-b-2 px-5 py-3 text-xs font-semibold",
              mobileStep === step
                ? "border-brand-blue text-brand-blue"
                : "border-transparent text-muted-foreground",
            )}
          >
            {index + 1}. {step === "account" ? "Account" : "Tools & price"}
          </li>
        ))}
      </ol>
      <div
        className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_23rem]"
        data-testid="signup-stage-grid"
      >
        <section
          className={cn(
            "min-w-0 p-5 sm:p-8 lg:block lg:p-10",
            mobileStep !== "account" && "hidden",
          )}
          aria-labelledby="account-details-title"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="hidden text-xs font-semibold uppercase tracking-wider text-brand-blue lg:block">
                Step 1 of 2
              </p>
              <h2
                ref={accountHeadingRef}
                id="account-details-title"
                tabIndex={-1}
                className="mt-2 text-lg font-semibold outline-none"
              >
                Your account
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Start with your details. You can invite your team later.
              </p>
            </div>
            <div className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
              <LockKeyhole className="size-3.5" /> Secure signup
            </div>
          </div>

          <div className="mt-6 min-w-0 space-y-4 sm:mt-7">
            {error ? (
              <p
                ref={accountErrorRef}
                className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive outline-none"
                role="alert"
                tabIndex={-1}
              >
                {error}
              </p>
            ) : null}

            {mode === "password" ? (
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full name</Label>
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
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@business.com"
                aria-invalid={Boolean(fieldErrors?.email)}
                aria-describedby={fieldErrors?.email ? "email-error" : undefined}
              />
              {fieldErrors?.email?.[0] ? (
                <p id="email-error" className="text-sm text-destructive" role="alert">
                  {fieldErrors.email[0]}
                </p>
              ) : null}
            </div>

            {mode === "password" ? (
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <PasswordInput
                    id="password"
                    name="password"
                    label="Password"
                    describedBy={fieldErrors?.password ? "password-error" : "password-help"}
                    invalid={Boolean(fieldErrors?.password)}
                  />
                  {fieldErrors?.password?.[0] ? (
                    <p id="password-error" className="mt-1.5 text-sm text-destructive" role="alert">
                      {fieldErrors.password[0]}
                    </p>
                  ) : (
                    <p id="password-help" className="mt-1.5 text-xs text-muted-foreground">
                      At least 8 characters.
                    </p>
                  )}
                </div>
                <div className="min-w-0">
                  <PasswordInput
                    id="confirm"
                    name="confirm"
                    label="Confirm password"
                    describedBy={passwordMismatch ? "confirm-error" : undefined}
                    invalid={passwordMismatch}
                  />
                  {passwordMismatch ? (
                    <p
                      ref={passwordMismatchRef}
                      id="confirm-error"
                      className="mt-1.5 text-sm text-destructive outline-none"
                      role="alert"
                      tabIndex={-1}
                    >
                      Passwords do not match.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                We&apos;ll email you a secure link. No password required.
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-brand-blue"
              onClick={() => {
                setPasswordMismatch(false);
                setMode((current) => (current === "password" ? "magic" : "password"));
              }}
            >
              {mode === "password" ? "Use a magic link" : "Create a password"}
            </Button>
            <p className="text-muted-foreground">
              Already registered?{" "}
              <Link
                href="/login"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
            </p>
          </div>
          <Button
            type="button"
            size="lg"
            className="mt-6 w-full lg:hidden"
            onClick={advanceToModules}
          >
            Choose your tools
          </Button>
        </section>

        <aside
          className={cn(
            "min-w-0 border-t border-border bg-muted/30 p-5 sm:p-8 lg:block lg:border-l lg:border-t-0",
            mobileStep !== "modules" && "hidden",
          )}
          aria-labelledby="module-selection-title"
        >
          <Button
            type="button"
            variant="ghost"
            className="-ml-3 mb-3 min-h-11 px-3 text-muted-foreground lg:hidden"
            onClick={() => moveToStep("account")}
          >
            <ArrowLeft className="size-4" /> Back to account
          </Button>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-blue">
                Your setup
              </p>
              <h2
                ref={modulesHeadingRef}
                id="module-selection-title"
                tabIndex={-1}
                className="mt-2 text-lg font-semibold outline-none"
              >
                Choose your tools
              </h2>
            </div>
            <span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs tabular-nums text-muted-foreground">
              {selectedKeys.length} selected
            </span>
          </div>

          <fieldset className="mt-5">
            <legend className="sr-only">Modules</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {DISPLAY_ORDER.map((key) => {
                const moduleMeta = MODULES[key];
                const Icon = moduleMeta.icon;
                const checked = selected.has(key);
                const item = pricing.modules.find((priced) => priced.key === key);
                const cents = item?.netCents ?? 0;
                return (
                  <label
                    key={key}
                    className={cn(
                      "flex min-h-16 min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border bg-card p-3 outline-none transition-colors has-[:focus-visible]:border-ring has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40 sm:gap-3",
                      checked ? "border-foreground" : "border-border hover:bg-muted/40",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleModule(key)}
                      className="sr-only"
                    />
                    <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-muted/50">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 overflow-hidden">
                      <span className="block text-sm font-medium">{moduleMeta.name}</span>
                      <span className="line-clamp-2 text-xs leading-4 text-muted-foreground">
                        {moduleMeta.description}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                      {checked ? (
                        <span className="whitespace-nowrap text-right font-mono text-xs tabular-nums">
                          {formatCents(cents)}
                          {suffix}
                        </span>
                      ) : null}
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-5 place-items-center rounded border",
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background",
                        )}
                      >
                        {checked ? <Check className="size-3.5" /> : null}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium">Billing</legend>
            <div className="mt-2 grid grid-cols-2 rounded-lg border border-border bg-card p-1">
              {(["monthly", "annual"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setInterval(value)}
                  aria-pressed={interval === value}
                  className={cn(
                    "min-h-11 cursor-pointer rounded-md px-2 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:px-3 lg:text-xs",
                    interval === value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {value === "monthly" ? "Monthly" : "Annual · save 25%"}
                </button>
              ))}
            </div>
          </fieldset>

          {promotion ? (
            <div
              className="mt-5 rounded-lg border border-success/30 bg-success/5 p-3 text-success"
              role="status"
            >
              <div className="flex items-start gap-2.5">
                <Tag className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Offer applied</p>
                  <p className="mt-0.5 text-xs">
                    {promotion.label} · <span className="font-mono">{promotion.code}</span>
                  </p>
                </div>
                <CheckCircle2 className="size-4 shrink-0" />
              </div>
            </div>
          ) : promotionUnavailable ? (
            <div
              className="mt-5 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning"
              role="status"
            >
              This promotional link is no longer available. You can still create an account at
              standard pricing.
            </div>
          ) : null}

          <div className="mt-5 border-t border-border pt-4">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm text-muted-foreground">
                {promotion ? "Estimated first payment" : "Estimated total"}
              </span>
              <span className="font-mono text-xl font-semibold tabular-nums">
                {formatCents(promotionalTotal)}
                <span className="ml-1 font-sans text-xs font-normal text-muted-foreground">
                  {suffix}
                </span>
              </span>
            </div>
            {pricing.totalDiscountCents > 0 ? (
              <p className="mt-1 flex items-center justify-end gap-1 text-xs text-success">
                <Sparkles className="size-3" /> Includes {formatCents(pricing.totalDiscountCents)}
                {suffix} module savings
              </p>
            ) : null}
            <p className="mt-2 text-right text-xs text-muted-foreground">
              AUD, excl. GST. Final total confirmed in Stripe.
            </p>
          </div>

          <Button
            type="submit"
            size="lg"
            className="mt-5 w-full"
            disabled={pending || selectedKeys.length === 0}
          >
            {pending
              ? "Creating your account…"
              : mode === "password"
                ? "Create account & continue"
                : "Email my sign-up link"}
          </Button>
          {selectedKeys.length === 0 ? (
            <p className="mt-2 text-center text-xs text-destructive" role="alert">
              Select at least one module to continue.
            </p>
          ) : (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              No charge until you review secure checkout.
            </p>
          )}
          <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
            By continuing, you agree to our{" "}
            <Link href="/terms" className="text-foreground underline-offset-4 hover:underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-foreground underline-offset-4 hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </aside>
      </div>
    </form>
  );
}
