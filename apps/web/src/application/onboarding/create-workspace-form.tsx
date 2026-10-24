"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, LockKeyhole, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createWorkspaceAction,
  type CreateWorkspaceResult,
} from "@/features/workspaces/api/workspaces";
import { startBillingCheckoutAction } from "@/features/billing/api/actions";
import { MODULES } from "@/config/modules";
import { formatCents, priceSubscription } from "@/lib/domain/billing/pricing";
import type { SignupIntent } from "@/lib/domain/billing/signup-intent";

type WorkspaceSetupResult =
  | { ok: true; workspaceId: string; checkoutUrl?: string }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string[]>;
      workspaceCreated?: boolean;
    };

const initialState: WorkspaceSetupResult = { ok: false, error: "" };

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (slug.length >= 2) return slug;
  return slug ? `${slug}-workspace` : "my-workspace";
}

export function CreateWorkspaceForm({
  intent,
  promotionLabel,
}: {
  intent?: SignupIntent;
  promotionLabel?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [state, formAction, isPending] = useActionState(
    async (_prev: WorkspaceSetupResult, formData: FormData): Promise<WorkspaceSetupResult> => {
      const workspaceResult: CreateWorkspaceResult = await createWorkspaceAction({
        name: String(formData.get("name") ?? ""),
        slug: slugify(String(formData.get("name") ?? "")),
      });
      if (!workspaceResult.ok) return workspaceResult;
      if (!intent) return workspaceResult;

      const checkout = await startBillingCheckoutAction({
        moduleKeys: intent.moduleKeys,
        interval: intent.interval,
        promotionCode: intent.promotionCode,
      });
      if (!checkout.ok) {
        return {
          ok: false,
          error: checkout.error,
          workspaceCreated: true,
        };
      }
      return { ...workspaceResult, checkoutUrl: checkout.url };
    },
    initialState,
  );

  useEffect(() => {
    if (!state.ok) return;
    if (state.checkoutUrl) window.location.assign(state.checkoutUrl);
    else router.push("/dashboard");
  }, [state, router]);

  const error = !state.ok ? state.error : "";
  const fieldErrors = !state.ok ? state.fieldErrors : undefined;
  const workspaceCreated = !state.ok && state.workspaceCreated;
  const pricing = intent ? priceSubscription(intent.moduleKeys, intent.interval) : null;
  const suffix = intent?.interval === "annual" ? "/yr" : "/mo";

  if (workspaceCreated) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 text-center">
        <div className="mx-auto grid size-10 place-items-center rounded-full border border-success/30 bg-success/10 text-success">
          <Check className="size-4" />
        </div>
        <h2 className="mt-4 font-semibold">Your workspace is ready</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          We couldn&apos;t open checkout: {error} You can retry safely from billing.
        </p>
        <Button type="button" className="mt-5 w-full" onClick={() => router.push("/billing")}>
          Continue to billing
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="name">Workspace name</Label>
        <Input
          id="name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Acme Trading"
          required
          minLength={2}
          maxLength={80}
          autoComplete="organization"
          aria-invalid={Boolean(fieldErrors?.name || fieldErrors?.slug)}
          aria-describedby={fieldErrors?.name || fieldErrors?.slug ? "name-error" : "name-help"}
        />
        {fieldErrors?.name?.[0] || fieldErrors?.slug?.[0] ? (
          <p id="name-error" className="text-sm text-destructive" role="alert">
            {fieldErrors.name?.[0] ?? fieldErrors.slug?.[0]}
          </p>
        ) : (
          <p id="name-help" className="text-xs text-muted-foreground">
            Your private workspace address will be /{slugify(name)}.
          </p>
        )}
      </div>

      {intent && pricing ? (
        <div className="min-w-0 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium">Your selected setup</p>
            <span className="text-xs capitalize text-muted-foreground">{intent.interval}</span>
          </div>
          <div className="mt-3 space-y-2">
            {pricing.modules.map((item) => (
              <div
                key={item.key}
                className="flex min-w-0 items-center justify-between gap-3 text-sm sm:gap-4"
              >
                <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <Check className="size-3.5 text-success" /> {MODULES[item.key].name}
                </span>
                <span className="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums">
                  {formatCents(item.netCents)}
                  {suffix}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
            <span className="text-sm font-medium">Total before offer</span>
            <span className="font-mono font-semibold tabular-nums">
              {formatCents(pricing.totalCents)}
              {suffix}
            </span>
          </div>
          {promotionLabel ? (
            <p className="mt-3 flex items-center gap-2 rounded-md bg-success/10 px-2.5 py-2 text-xs text-success">
              <Tag className="size-3.5" /> {promotionLabel} will be applied automatically
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending
          ? intent
            ? "Preparing secure checkout…"
            : "Creating your workspace…"
          : intent
            ? "Create workspace & review payment"
            : "Create your workspace"}
        {!isPending && intent ? <ExternalLink className="size-4" /> : null}
      </Button>
      {intent ? (
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <LockKeyhole className="size-3.5" /> Payment details are collected securely by Stripe.
        </p>
      ) : null}
    </form>
  );
}
