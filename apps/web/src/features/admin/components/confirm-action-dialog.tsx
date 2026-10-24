"use client";

import * as React from "react";
import { useEffect, useActionState, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdminActionResult } from "@/features/admin/api/actions";

export type DialogFieldType = "text" | "number" | "textarea" | "select" | "checkbox-group";

export interface ConfirmDialogField {
  name: string;
  label: string;
  type?: DialogFieldType;
  /** Options for select / checkbox-group. */
  options?: { value: string; label: string }[];
  /** Pre-checked values for checkbox-group. */
  defaultValues?: string[];
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  helperText?: string;
  rows?: number;
}

interface ConfirmActionDialogProps {
  /** Trigger element — typically a <Button>. Rendered via DialogTrigger asChild. */
  trigger: React.ReactNode;
  title: string;
  description?: string;
  /** Visible, user-editable fields. A required `reason` textarea is the common case. */
  fields?: ConfirmDialogField[];
  /** Prefilled values not shown to the user (ids, state). Merged into the action input. */
  hidden?: Record<string, string>;
  /** Server Action wrapper that receives the merged string record and returns a result. */
  action: (input: Record<string, string>) => Promise<AdminActionResult>;
  submitLabel?: string;
  destructive?: boolean;
  successMessage?: string;
}

const textareaClass =
  "flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const selectClass =
  "h-9 max-md:h-11 w-full rounded-md border border-input bg-background px-3 text-sm max-md:text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function FieldInput({ field, error }: { field: ConfirmDialogField; error?: string }) {
  const id = `admin-field-${field.name}`;
  const requiredMark = field.required ? <span className="text-destructive"> *</span> : null;

  let control: React.ReactNode;
  if (field.type === "textarea") {
    control = (
      <textarea
        id={id}
        name={field.name}
        rows={field.rows ?? 4}
        required={field.required}
        defaultValue={field.defaultValue}
        placeholder={field.placeholder}
        aria-invalid={Boolean(error)}
        className={textareaClass}
      />
    );
  } else if (field.type === "select") {
    control = (
      <select
        id={id}
        name={field.name}
        required={field.required}
        defaultValue={field.defaultValue}
        aria-invalid={Boolean(error)}
        className={selectClass}
      >
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (field.type === "checkbox-group") {
    control = (
      <div
        id={id}
        role="group"
        aria-label={field.label}
        className="grid grid-cols-1 gap-1.5 sm:grid-cols-2"
      >
        {field.options?.map((o) => {
          const checkboxId = `${id}-${o.value}`;
          return (
            <label
              key={o.value}
              htmlFor={checkboxId}
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-accent"
            >
              <input
                id={checkboxId}
                type="checkbox"
                name={field.name}
                value={o.value}
                defaultChecked={field.defaultValues?.includes(o.value)}
                className="size-4 rounded-sm border-input accent-brand-blue"
              />
              <span>{o.label}</span>
            </label>
          );
        })}
      </div>
    );
  } else {
    control = (
      <Input
        id={id}
        name={field.name}
        type={field.type ?? "text"}
        required={field.required}
        defaultValue={field.defaultValue}
        placeholder={field.placeholder}
        min={field.min}
        max={field.max}
        step={field.step}
        aria-invalid={Boolean(error)}
      />
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {field.label}
        {requiredMark}
      </Label>
      {control}
      {field.helperText && !error ? (
        <p className="text-xs text-muted-foreground">{field.helperText}</p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export function ConfirmActionDialog({
  trigger,
  title,
  description,
  fields = [],
  hidden = {},
  action,
  submitLabel = "Confirm",
  destructive = false,
  successMessage = "Done.",
}: ConfirmActionDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (_prev: AdminActionResult | null, formData: FormData): Promise<AdminActionResult> => {
      const input: Record<string, string> = { ...hidden };
      for (const f of fields) {
        if (f.type === "checkbox-group") {
          // Multi-select: join checked values with a comma. The consuming
          // wrapper splits this back into an array for its typed action input.
          input[f.name] = (formData.getAll(f.name) as string[]).join(",");
        } else {
          input[f.name] = String(formData.get(f.name) ?? "");
        }
      }
      return action(input);
    },
    null,
  );

  // Track which result we've already closed the dialog for, so we only close
  // once per submit. Adjusting state during render (not in an effect) avoids
  // the react-hooks/set-state-in-effect lint rule.
  const [closedFor, setClosedFor] = useState<AdminActionResult | null>(null);
  if (state && state.ok && state !== closedFor) {
    setClosedFor(state);
    setOpen(false);
  }

  // Toasts hit an external system (sonner) — effects are the right place for
  // side effects; toast/toast are not React state setters so this is allowed.
  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(successMessage);
    else if (!state.fieldErrors) toast.error(state.error);
  }, [state, successMessage]);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          {fields.map((f) => (
            <FieldInput key={f.name} field={f} error={fieldErrors?.[f.name]?.[0]} />
          ))}
          {state && !state.ok && !state.fieldErrors ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={pending}
            >
              {pending ? "Working…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
