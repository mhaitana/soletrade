"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/shared/components/responsive-dialog";
import { MODULES, MODULE_KEYS, type ModuleKey } from "@/shared/constants/modules";
import {
  disableModuleAction,
  enableModuleAction,
  previewAddModuleAction,
  previewCancelModuleAction,
  cancelModuleAction,
  undoCancelModuleAction,
  type AddModulePreview,
  type CancelModulePreviewResult,
  type ModulesPageData,
} from "@/app/(app)/actions/module-installations";
import { CancellationModal, type CancelOptionChoice } from "@/app/(app)/billing/cancellation-modal";

type PreviewPayload = Extract<AddModulePreview, { ok: true }>;

function formatDate(d: Date | null): string {
  if (!d) return "-";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const CANCEL_LABELS: Record<string, { label: string; description: string }> = {
  keep_until_end_of_cycle: {
    label: "Keep until end of cycle",
    description: "The module stays active until your current billing period ends, then is removed.",
  },
  immediate_credit: {
    label: "Refund to platform credit",
    description:
      "Cancel now. Unused time is refunded to your platform credit balance to apply to future invoices.",
  },
  immediate_refund: {
    label: "Refund to payment method",
    description: "Cancel now. Unused time is refunded to your original payment method.",
  },
};

export function ModulesManager({ initial }: { initial: ModulesPageData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [dialogOpen, setResponsiveDialogOpen] = useState(false);
  const [previewingKey, setPreviewingKey] = useState<ModuleKey | null>(null);

  // Cancellation flow state.
  const [cancelPreview, setCancelPreview] = useState<Extract<
    CancelModulePreviewResult,
    { ok: true }
  > | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [previewingCancelKey, setPreviewingCancelKey] = useState<ModuleKey | null>(null);

  function runEnable(key: ModuleKey) {
    startTransition(async () => {
      const res = await enableModuleAction(key);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResponsiveDialogOpen(false);
      setPreview(null);
      router.refresh();
    });
  }

  async function onEnableClick(key: ModuleKey) {
    setError(null);
    setPreviewingKey(key);
    const res = await previewAddModuleAction(key);
    setPreviewingKey(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (res.proratedCents <= 0) {
      runEnable(key);
      return;
    }
    setPreview(res);
    setResponsiveDialogOpen(true);
  }

  async function onDisableClick(key: ModuleKey) {
    setError(null);
    setPreviewingCancelKey(key);
    setCancelError(null);
    const res = await previewCancelModuleAction(key);
    setPreviewingCancelKey(null);
    if (!res.ok) {
      // No active billing or permission error. For no-billing, fall back to a direct
      // disable (legacy behavior) - surface the error only if it isn't the no-billing
      // case. previewCancelModuleAction returns no-billing as a 1-option ok payload,
      // so an !ok here is a permission/unknown-module error.
      setError(res.error);
      return;
    }
    if (res.options.length <= 1) {
      // No active billing → only the keep option (= just disable locally). Disable
      // directly without a cancellation modal (the existing behavior).
      startTransition(async () => {
        const r = await disableModuleAction(key);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        router.refresh();
      });
      return;
    }
    setCancelPreview(res);
    setCancelOpen(true);
  }

  function onConfirmCancel(value: string) {
    const key = cancelPreview?.moduleKey;
    if (!key) return;
    setCancelError(null);
    startTransition(async () => {
      const res = await cancelModuleAction({ moduleKey: key, option: value });
      if (!res.ok) {
        setCancelError(res.error);
        return;
      }
      setCancelOpen(false);
      setCancelPreview(null);
      router.refresh();
    });
  }

  function onUndoCancel(key: ModuleKey) {
    setError(null);
    startTransition(async () => {
      const res = await undoCancelModuleAction(key);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const pendingConfirm = isPending && !!preview;
  const cancelChoices: CancelOptionChoice[] = cancelPreview
    ? cancelPreview.options.map((o) => {
        const labels = CANCEL_LABELS[o.option] ?? {
          label: o.option,
          description: "",
        };
        return {
          value: o.option,
          label: labels.label,
          description: labels.description,
          amountCents: o.amountCents,
          recommended: o.recommended,
        };
      })
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Modules</h1>
        <p className="text-sm text-muted-foreground">
          Enable or disable modules for this workspace. Adding a module mid-cycle charges a prorated
          amount for the rest of the current billing period.
        </p>
      </div>

      {!initial.canManage ? (
        <p className="rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          Only owners and admins can manage modules.
        </p>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {MODULE_KEYS.map((key) => {
          const meta = MODULES[key];
          const enabled = initial.installed.includes(key);
          const Icon = meta.icon;
          const loadingPreview = previewingKey === key || previewingCancelKey === key;
          const pending = initial.pendingCancellations.find((p) => p.moduleKey === key);
          const cancelDate = pending ? formatDate(new Date(pending.effectiveAt)) : null;
          return (
            <Card key={key}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-md bg-muted">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <div>
                      <CardTitle className="text-base">{meta.name}</CardTitle>
                      <CardDescription>{meta.description}</CardDescription>
                    </div>
                  </div>
                  {enabled ? (
                    pending ? (
                      <Badge variant="outline" className="border-amber-500/40 text-amber-600">
                        Cancels on {cancelDate}
                      </Badge>
                    ) : (
                      <Badge>Enabled</Badge>
                    )
                  ) : (
                    <Badge variant="outline">Disabled</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {enabled && pending ? (
                  <Button
                    variant="outline"
                    disabled={!initial.canManage || isPending || loadingPreview}
                    onClick={() => void onUndoCancel(key)}
                    aria-label={`Undo cancellation of ${meta.name}`}
                  >
                    {isPending ? "Restoring…" : "Undo cancel"}
                  </Button>
                ) : (
                  <Button
                    variant={enabled ? "outline" : "default"}
                    disabled={!initial.canManage || isPending || loadingPreview}
                    onClick={() => (enabled ? void onDisableClick(key) : void onEnableClick(key))}
                    aria-label={enabled ? `Disable ${meta.name}` : `Enable ${meta.name}`}
                  >
                    {loadingPreview ? "Calculating…" : enabled ? "Disable" : "Enable"}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Add-module proration confirm */}
      <ResponsiveDialog open={dialogOpen} onOpenChange={setResponsiveDialogOpen}>
        <ResponsiveDialogContent>
          {preview ? (
            <>
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>
                  Add {MODULES[preview.moduleKey].name}?
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  You&apos;re adding <strong>{MODULES[preview.moduleKey].name}</strong> as{" "}
                  {preview.becomesAnchor
                    ? "your anchor app (the highest-priced module in your stack)"
                    : "an add-on"}
                  . A prorated charge for the rest of the current billing period is collected today;
                  the full {preview.interval} price applies from your next invoice.
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Due today (prorated)</dt>
                <dd className="text-right font-medium tabular-nums">{preview.proratedDisplay}</dd>
                <dt className="text-muted-foreground">
                  {preview.interval === "annual" ? "Annual" : "Monthly"} price
                </dt>
                <dd className="text-right font-medium tabular-nums">
                  {preview.netDisplay}
                  {preview.interval === "annual" ? "/yr" : "/mo"}
                </dd>
                <dt className="text-muted-foreground">Period ends</dt>
                <dd className="text-right">{formatDate(preview.periodEnd)}</dd>
              </dl>
              <ResponsiveDialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setResponsiveDialogOpen(false);
                    setPreview(null);
                  }}
                  disabled={pendingConfirm}
                >
                  Cancel
                </Button>
                <Button onClick={() => void runEnable(preview.moduleKey)} disabled={pendingConfirm}>
                  {pendingConfirm ? "Adding…" : `Add for ${preview.proratedDisplay}`}
                </Button>
              </ResponsiveDialogFooter>
            </>
          ) : null}
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Cancel-module options */}
      <CancellationModal
        key={cancelPreview?.moduleKey ?? "none"}
        open={cancelOpen}
        onOpenChange={(o) => {
          setCancelOpen(o);
          if (!o) setCancelPreview(null);
        }}
        title={
          cancelPreview ? `Cancel ${MODULES[cancelPreview.moduleKey].name}?` : "Cancel module?"
        }
        description={
          cancelPreview?.branch === "offboarding"
            ? "This is the last active module in your workspace - cancelling it ends your subscription. Unused time in the current period can be refunded to your payment method, or you can keep access until the period ends."
            : "You can keep this module until the current billing period ends, or cancel now for a pro-rated refund. Choose how you'd like to proceed."
        }
        periodEnd={cancelPreview?.periodEnd ?? null}
        options={cancelChoices}
        onConfirm={onConfirmCancel}
        pending={isPending}
        error={cancelError}
      />
    </div>
  );
}
