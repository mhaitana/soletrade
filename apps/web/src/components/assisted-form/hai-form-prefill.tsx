"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleDashed, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  haiFormDirectiveSchema,
  type HaiFormDirective,
  type HaiFormWorkflow,
} from "@/lib/assisted-form/hai-workflows";

const STORAGE_KEY = "hai:assisted-form-draft";
const MAX_AGE_MS = 30 * 60 * 1000;

export interface HaiPrefillResolution {
  /** Labels actually applied by the form adapter. Defaults to the directive's labels. */
  appliedFields?: string[];
  /** Fields that could not be safely resolved (for example an ambiguous customer name). */
  unresolvedFields?: string[];
}

export interface HaiPrefillNoticeData {
  requestSummary: string;
  appliedFields: string[];
  missingFields: string[];
}

export function storeHaiFormDirective(directive: HaiFormDirective): void {
  if (typeof window === "undefined") return;
  const parsed = haiFormDirectiveSchema.parse(directive);
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
}

function takeHaiFormDirective(workflow: HaiFormWorkflow): HaiFormDirective | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    window.sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }

  const parsed = haiFormDirectiveSchema.safeParse(value);
  if (!parsed.success || Date.now() - parsed.data.createdAt > MAX_AGE_MS) {
    window.sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
  if (parsed.data.workflow !== workflow) return null;

  // Consume exactly once. A refresh after the user starts editing must not overwrite
  // their changes with the original assistant values.
  window.sessionStorage.removeItem(STORAGE_KEY);
  return parsed.data;
}

/**
 * Consume hAI's one-shot handoff into a form's local state. The callback lives in a
 * ref so forms do not need to memoize a large setter map just to keep the effect stable.
 */
export function useHaiFormPrefill(
  workflow: HaiFormWorkflow,
  apply: (fields: Record<string, unknown>) => HaiPrefillResolution | void,
): HaiPrefillNoticeData | null {
  const applyRef = useRef(apply);
  const [notice, setNotice] = useState<HaiPrefillNoticeData | null>(null);

  useEffect(() => {
    applyRef.current = apply;
  });

  useEffect(() => {
    const directive = takeHaiFormDirective(workflow);
    if (!directive) return;

    const resolution = applyRef.current(directive.fields);
    const appliedFields = resolution?.appliedFields ?? directive.providedFields;
    const missingFields = Array.from(
      new Set([...directive.missingFields, ...(resolution?.unresolvedFields ?? [])]),
    );
    setNotice({
      requestSummary: directive.requestSummary,
      appliedFields,
      missingFields,
    });
  }, [workflow]);

  return notice;
}

export function HaiPrefillNotice({
  notice,
  className,
}: {
  notice: HaiPrefillNoticeData | null;
  className?: string;
}) {
  if (!notice) return null;
  return (
    <aside
      className={cn("rounded-xl border border-brand-blue/25 bg-brand-blue/5 p-4", className)}
      aria-label="hAI assisted draft"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-brand-blue/25 bg-background text-brand-blue">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">hAI prepared an unsaved draft</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            From “{notice.requestSummary}”. Review every field; nothing has been saved or sent.
          </p>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
              <span>
                <span className="font-medium text-foreground">Prefilled:</span>{" "}
                {notice.appliedFields.length > 0 ? notice.appliedFields.join(", ") : "no fields"}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
              <span>
                <span className="font-medium text-foreground">Still to review:</span>{" "}
                {notice.missingFields.length > 0
                  ? notice.missingFields.join(", ")
                  : "all required details are present"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function fieldString(fields: Record<string, unknown>, key: string): string | undefined {
  const value = fields[key];
  return typeof value === "string" ? value : undefined;
}

export function fieldNumber(fields: Record<string, unknown>, key: string): number | undefined {
  const value = fields[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function fieldBoolean(fields: Record<string, unknown>, key: string): boolean | undefined {
  const value = fields[key];
  return typeof value === "boolean" ? value : undefined;
}

/** Match a human name/email/company against a form's existing picker options. */
export function resolvePickerId(
  query: string,
  options: { id: string; name: string; email?: string | null; company?: string | null }[],
): string | null {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return null;
  const exact = options.filter((option) =>
    [option.id, option.name, option.email, option.company]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.trim().toLocaleLowerCase() === needle),
  );
  return exact.length === 1 ? exact[0]!.id : null;
}
