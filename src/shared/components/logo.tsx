import Link from "next/link";
import { cn } from "@/shared/lib/utils";
import { brand } from "@/config/brand";

/**
 * Product brand lockup: the `h` mark + wordmark.
 *
 * `variant` controls what renders alongside the `h` mark:
 *  - `full`    - `soletrade` wordmark (external: marketing, auth, onboarding, error/not-found, invite)
 *  - `compact` - `Business` short label (in-app sidebar/mobile sheet, where the mark is already visible)
 *  - `mark`    - `h` mark only        (public invoice/quote pages, where the issuing merchant is the
 *               dominant brand and Soletrade must stay subtle/secondary)
 *
 * The full lockup uses `brand.wordmark` (`soletrade`); the compact label uses
 * `brand.shortProductName` (`Business`). The prose product name (`Soletrade`) is NOT
 * rendered here - it lives in titles, metadata, and body copy.
 */
export type LogoVariant = "full" | "compact" | "mark";

export function Logo({
  className,
  href = "/",
  variant = "full",
}: {
  className?: string;
  href?: string | null;
  variant?: LogoVariant;
}) {
  const wordmark =
    variant === "full" ? brand.wordmark : variant === "compact" ? brand.shortProductName : null;
  const content = (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-semibold tracking-tight",
        variant === "compact" && "gap-1.5",
        className,
      )}
    >
      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
      >
        h
      </span>
      {wordmark ? <span>{wordmark}</span> : null}
    </span>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}
