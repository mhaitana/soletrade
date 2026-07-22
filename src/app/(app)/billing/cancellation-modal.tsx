"use client";

import { useState } from "react";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/shared/components/responsive-dialog";
import { Button } from "@/shared/ui/button";
import { formatCents } from "@/platform/billing/pricing";

/**
 * Shared cancellation confirm modal (brief §10.6). Renders the branch-aware options
 * returned by a preview action as a radio list with amounts + a recommended badge,
 * then calls `onConfirm` with the chosen option value. Used by both the per-module
 * cancel flow (`modules-manager.tsx`) and the cancel-all flow
 * (`billing-manage-actions.tsx`); each caller builds the `options` list from its own
 * preview payload and maps the selected value to its action's input.
 *
 * Money renders use `tabular-nums` per workspace rule. Errors surface inline via
 * `role="alert"`. The recommended option is pre-selected on open.
 */

export interface CancelOptionChoice {
  /** The value passed back to `onConfirm`. Caller maps this to the action's input. */
  value: string;
  label: string;
  description: string;
  /** Cents moved by this option (0 for keep). Displayed with `formatCents`. */
  amountCents: number;
  recommended: boolean;
}

interface CancellationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  periodEnd: Date | null;
  options: CancelOptionChoice[];
  onConfirm: (value: string) => void;
  pending: boolean;
  error: string | null;
}

function formatDate(d: Date | null): string {
  if (!d) return "-";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function CancellationModal({
  open,
  onOpenChange,
  title,
  description,
  periodEnd,
  options,
  onConfirm,
  pending,
  error,
}: CancellationModalProps) {
  const recommended = options.find((o) => o.recommended);
  const defaultSelected = recommended?.value ?? options[0]?.value ?? "";
  // Selection is seeded from the recommended option. Callers pass a `key` that changes
  // per preview so React remounts this component (re-initializing `selected`) when a
  // fresh preview is loaded - no effect or render-time ref needed.
  const [selected, setSelected] = useState<string>(defaultSelected);

  const selectedChoice = options.find((o) => o.value === selected) ?? options[0];

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{description}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <fieldset className="space-y-2" aria-label="Cancellation options">
          {options.map((o) => {
            const id = `cancel-opt-${o.value}`;
            const checked = selected === o.value;
            return (
              <label
                key={o.value}
                htmlFor={id}
                className={`flex cursor-pointer items-start justify-between gap-3 rounded-md border p-3 transition-colors ${
                  checked ? "border-primary bg-accent/40" : "border-border hover:bg-accent/20"
                }`}
              >
                <span className="flex flex-col gap-1">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <input
                      id={id}
                      type="radio"
                      name="cancel-option"
                      value={o.value}
                      checked={checked}
                      onChange={() => setSelected(o.value)}
                      className="mt-0.5 size-4 accent-primary"
                    />
                    {o.label}
                    {o.recommended ? (
                      <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                        Recommended
                      </span>
                    ) : null}
                  </span>
                  <span className="pl-7 text-xs text-muted-foreground">{o.description}</span>
                </span>
                <span
                  className="shrink-0 text-sm font-medium tabular-nums"
                  aria-label={`Amount: ${formatCents(o.amountCents)}`}
                >
                  {o.amountCents > 0 ? `+${formatCents(o.amountCents)}` : "-"}
                </span>
              </label>
            );
          })}
        </fieldset>

        <p className="text-xs text-muted-foreground">
          Current billing period ends <strong>{formatDate(periodEnd)}</strong>.
        </p>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            onClick={() => selectedChoice && onConfirm(selectedChoice.value)}
            disabled={pending || !selectedChoice}
          >
            {pending ? "Processing…" : "Confirm cancellation"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
