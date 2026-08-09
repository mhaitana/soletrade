"use client";

import Link from "next/link";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/ui/button";

export function PromotionLink({ code, appUrl }: { code: string; appUrl: string }) {
  const [copied, setCopied] = useState(false);
  const relativeHref = `/signup?promo=${encodeURIComponent(code)}`;
  const shareUrl = `${appUrl.replace(/\/$/, "")}${relativeHref}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked by browser policy; the adjacent link remains selectable.
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Link
        href={relativeHref}
        target="_blank"
        className="inline-flex items-center gap-1 font-mono text-xs text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        {code}
        <ExternalLink className="size-3" />
      </Link>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={copyLink}
        aria-label={copied ? "Promotional link copied" : `Copy promotional link for ${code}`}
      >
        {copied ? <Check className="text-success" /> : <Copy />}
      </Button>
    </span>
  );
}
