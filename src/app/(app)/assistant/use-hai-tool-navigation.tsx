"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  Navigation,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import {
  getToolName,
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage,
  type UITools,
} from "ai";
import { cn } from "@/shared/lib/utils";
import {
  haiFormDirectiveSchema,
  haiNavigationDirectiveSchema,
  type HaiFormDirective,
  type HaiNavigationDirective,
} from "./hai-workflows";
import { storeHaiFormDirective } from "./hai-form-prefill";

type HaiToolResult =
  | { kind: "form"; directive: HaiFormDirective }
  | { kind: "navigate"; directive: HaiNavigationDirective }
  | { kind: "error"; error: string };

type AnyToolPart = ToolUIPart<UITools> | DynamicToolUIPart;

function parseToolResult(part: AnyToolPart): HaiToolResult | null {
  if (part.state !== "output-available") return null;
  const name = getToolName(part);
  const output = part.output;
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  if (record.ok === false && typeof record.error === "string") {
    return { kind: "error", error: record.error };
  }
  if (name === "openForm") {
    const parsed = haiFormDirectiveSchema.safeParse(record.directive);
    return parsed.success ? { kind: "form", directive: parsed.data } : null;
  }
  if (name === "navigateWorkspace") {
    const parsed = haiNavigationDirectiveSchema.safeParse(record.directive);
    return parsed.success ? { kind: "navigate", directive: parsed.data } : null;
  }
  return null;
}

/** Execute only the two explicitly safe client-side hAI directives. */
export function useHaiToolNavigation(messages: UIMessage[]): void {
  const router = useRouter();
  const handled = useRef(new Set<string>());

  useEffect(() => {
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (!isToolUIPart(part) || handled.current.has(part.toolCallId)) continue;
        const result = parseToolResult(part);
        if (!result || result.kind === "error") continue;
        handled.current.add(part.toolCallId);
        if (result.kind === "form") {
          storeHaiFormDirective(result.directive);
          router.push(result.directive.href);
        } else {
          router.push(result.directive.href);
        }
      }
    }
  }, [messages, router]);
}

export function HaiToolPart({ part }: { part: AnyToolPart }) {
  const name = getToolName(part);
  if (name !== "openForm" && name !== "navigateWorkspace") return null;

  if (part.state === "output-error") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {part.errorText}
      </div>
    );
  }
  if (part.state !== "output-available") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        Preparing a safe destination…
      </div>
    );
  }

  const result = parseToolResult(part);
  if (!result) return null;
  if (result.kind === "error") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/5 p-3 text-xs">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
        <span>{result.error}</span>
      </div>
    );
  }

  const isForm = result.kind === "form";
  const directive = result.directive;
  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-xs",
        isForm ? "border-brand-blue/25 bg-brand-blue/5" : "border-border bg-muted/40",
      )}
    >
      <div className="flex items-start gap-2">
        {isForm ? (
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand-blue" aria-hidden />
        ) : (
          <Navigation className="mt-0.5 size-3.5 shrink-0 text-brand-blue" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">
            {isForm ? "Opening unsaved draft" : "Navigating"}: {directive.label}
          </p>
          <p className="mt-1 text-muted-foreground">
            {isForm
              ? "Prefilled fields remain unsaved until you review and submit the form."
              : "This navigation does not change business data."}
          </p>
          {isForm && result.directive.providedFields.length > 0 ? (
            <p className="mt-1 text-muted-foreground">
              <CheckCircle2 className="mr-1 inline size-3" aria-hidden />
              {result.directive.providedFields.join(", ")}
            </p>
          ) : null}
        </div>
        <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </div>
    </div>
  );
}
