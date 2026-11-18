"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  LoaderCircle,
  Navigation,
  Search,
  ShieldAlert,
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
import { cn } from "@/lib/utils";
import {
  haiFormDirectiveSchema,
  haiNavigationDirectiveSchema,
  type HaiFormDirective,
  type HaiNavigationDirective,
} from "@/lib/assisted-form/hai-workflows";
import { storeHaiFormDirective } from "@/components/assisted-form/hai-form-prefill";
import { assistantToolInfo, readToolCardFields } from "@/lib/assistant/tool-catalog";
import { toolCallParts, type ActionPreview } from "@/lib/assistant/messages";
import { Button } from "@/components/ui/button";

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

/** Every tool call id in these messages, e.g. the ones loaded from a stored conversation. */
export function toolCallIdsOf(messages: readonly { parts: readonly unknown[] }[]): Set<string> {
  return new Set(messages.flatMap((message) => toolCallParts(message).map((p) => p.toolCallId)));
}

/**
 * Execute only the two explicitly safe client-side hAI directives, once, as their results
 * arrive. Calls in `settled` (loaded from a stored conversation) already ran when they
 * were made, so reopening a conversation never navigates or reopens a form.
 */
export function useHaiToolNavigation(
  messages: UIMessage[],
  settled: ReadonlySet<string> = EMPTY,
): void {
  const router = useRouter();
  const handled = useRef(new Set<string>());

  useEffect(() => {
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (!isToolUIPart(part)) continue;
        if (handled.current.has(part.toolCallId) || settled.has(part.toolCallId)) continue;
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
  }, [messages, router, settled]);
}

const EMPTY: ReadonlySet<string> = new Set();

const CAUTION_TEXT = {
  "sends-message": "This sends an email to someone outside your workspace.",
  "cannot-undo": "This can't be undone.",
} as const;

/**
 * A change hAI proposed. Nothing runs until the person approves it here; the server holds
 * the change itself and only takes the yes or no from this card.
 */
function HaiApprovalCard({
  part,
  name,
  preview,
  onDecide,
  disabled,
}: {
  part: AnyToolPart;
  name: string;
  preview: ActionPreview | null;
  onDecide?: (approvalId: string, approved: boolean) => void;
  disabled?: boolean;
}) {
  const info = assistantToolInfo(name);
  const title = preview?.title ?? info.running;
  const approval = "approval" in part ? part.approval : undefined;

  if (
    part.state === "output-denied" ||
    (part.state === "approval-responded" && !approval?.approved)
  ) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs">
        <Ban className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span>
          <span className="font-medium text-foreground">Not done: {title}</span>
          {approval?.reason ? (
            <span className="text-muted-foreground"> {approval.reason}</span>
          ) : (
            <span className="text-muted-foreground"> You declined this change.</span>
          )}
        </span>
      </div>
    );
  }
  if (part.state === "approval-responded") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        Approved. {info.running}…
      </div>
    );
  }

  const caution = preview?.caution ?? info.caution;
  const approvalId = approval?.id;
  return (
    <div
      role="group"
      aria-label={`Approval needed: ${title}`}
      className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs"
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-medium text-foreground">{title}</p>
          {preview && preview.details.length > 0 ? (
            <ul className="space-y-0.5 text-muted-foreground">
              {preview.details.map((line, index) => (
                <li key={index} className="break-words">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
          {preview?.consequence ? <p className="text-foreground">{preview.consequence}</p> : null}
          {caution ? <p className="font-medium text-warning">{CAUTION_TEXT[caution]}</p> : null}
          {onDecide && approvalId ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                disabled={disabled}
                onClick={() => onDecide(approvalId, true)}
                aria-label={`Approve: ${title}`}
              >
                Approve
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => onDecide(approvalId, false)}
                aria-label={`Decline: ${title}`}
              >
                Decline
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground">Waiting for your approval.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One card per tool call, so nothing the assistant does is invisible: lookups show what
 * was searched and how much came back, and changes show what was done with a link to the
 * record. Navigation and draft-form results keep their own richer card below.
 */
function HaiActivityCard({ part, name }: { part: AnyToolPart; name: string }) {
  const info = assistantToolInfo(name);

  if (part.state === "output-error") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          {info.kind === "write" ? "This action did not complete." : "This lookup failed."}{" "}
          {part.errorText}
        </span>
      </div>
    );
  }
  if (part.state !== "output-available") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        {info.running}…
      </div>
    );
  }

  const fields = readToolCardFields(part.output);
  if (fields.error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/5 p-3 text-xs">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
        <span>
          <span className="font-medium text-foreground">
            {info.kind === "write" ? "Nothing was changed." : "Nothing was found."}
          </span>{" "}
          {fields.error}
        </span>
      </div>
    );
  }

  const isWrite = info.kind === "write";
  const count =
    !isWrite && typeof fields.returned === "number"
      ? `${fields.returned}${fields.hasMore ? "+" : ""} found`
      : null;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border p-3 text-xs",
        isWrite ? "border-success/25 bg-success/5" : "border-border bg-muted/40",
      )}
    >
      {isWrite ? (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
      ) : (
        <Search className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className={cn(isWrite ? "font-medium text-foreground" : "text-muted-foreground")}>
          {info.done}
          {fields.recordLabel ? `: ${fields.recordLabel}` : ""}
          {count ? ` · ${count}` : ""}
        </p>
        {fields.hasMore ? (
          <p className="mt-1 text-muted-foreground">
            More matched than are shown here, so this list is partial.
          </p>
        ) : null}
      </div>
      {fields.href ? (
        <Link
          href={fields.href}
          // The visible word alone ("Open") says nothing out of context; name the target too.
          aria-label={`${isWrite ? "Open" : "View"} ${fields.recordLabel ?? info.done.toLowerCase()}`}
          className="shrink-0 rounded font-medium text-brand-blue underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {isWrite ? "Open" : "View"}
        </Link>
      ) : null}
    </div>
  );
}

export function HaiToolPart({
  part,
  preview = null,
  onDecide,
  disabled,
}: {
  part: AnyToolPart;
  /** The server's description of a proposed change (from the message's data part). */
  preview?: ActionPreview | null;
  /** Approve or decline a proposed change. Without it the card only shows its state. */
  onDecide?: (approvalId: string, approved: boolean) => void;
  disabled?: boolean;
}) {
  const name = getToolName(part);
  if (
    part.state === "approval-requested" ||
    part.state === "approval-responded" ||
    part.state === "output-denied"
  ) {
    return (
      <HaiApprovalCard
        part={part}
        name={name}
        preview={preview}
        onDecide={onDecide}
        disabled={disabled}
      />
    );
  }
  if (name !== "openForm" && name !== "navigateWorkspace") {
    return <HaiActivityCard part={part} name={name} />;
  }

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
