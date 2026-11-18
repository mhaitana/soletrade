"use client";

import { ArrowUpRight } from "lucide-react";

/**
 * Suggested first messages for an empty hAI chat. The side panel and the assistant page
 * both use these rows, so starting a conversation looks the same in either place.
 */
export function HaiStarters({
  prompts,
  onPick,
  disabled,
  className,
}: {
  prompts: readonly string[];
  onPick: (prompt: string) => void;
  disabled?: boolean;
  /** How the rows are laid out, e.g. `space-y-2` or a grid. */
  className: string;
}) {
  return (
    <div className={className}>
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          onClick={() => onPick(prompt)}
          disabled={disabled}
          className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-default disabled:opacity-50"
        >
          <span>{prompt}</span>
          <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      ))}
    </div>
  );
}
