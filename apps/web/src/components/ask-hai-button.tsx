"use client";

import type { ComponentProps } from "react";
import { Sparkles } from "lucide-react";
import { brand } from "@/config/brand";
import { askHai } from "@/lib/assistant/launcher";
import { Button } from "@/components/ui/button";

/**
 * Opens hAI with a question about what is on screen, e.g. "Summarise this invoice" on an
 * invoice page. hAI is told which page the person is on with every message, so the
 * question can say "this invoice" and the record is looked up from there.
 */
export function AskHaiButton({
  question,
  label = `Ask ${brand.assistantName}`,
  variant = "outline",
  ...props
}: {
  /** What to ask. It is sent straight away, as a new conversation. */
  question: string;
  label?: string;
} & Omit<ComponentProps<typeof Button>, "onClick" | "children" | "type">) {
  return (
    <Button
      type="button"
      variant={variant}
      onClick={() => askHai({ question, send: true })}
      {...props}
    >
      <Sparkles className="size-4 text-brand-blue" aria-hidden />
      {label}
    </Button>
  );
}
