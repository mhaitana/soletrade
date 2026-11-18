"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Copies a full, shareable URL for an in-app path (for example the customer's payment or
 * quote page) to the clipboard. The origin is read in the browser, so the copied link
 * matches whichever host the user is on. Pure presentational - no feature imports.
 */
export function CopyLinkButton({
  path,
  label = "Copy link",
  copiedMessage = "Link copied.",
}: {
  /** In-app path beginning with "/". */
  path: string;
  label?: string;
  copiedMessage?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(copiedMessage);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (permissions, insecure context). Show the link so
      // it can still be copied by hand.
      toast.error(`Couldn't copy automatically. The link is ${url}`);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
      {copied ? <Check className="size-4" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
      {label}
    </Button>
  );
}
