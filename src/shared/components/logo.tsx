import Link from "next/link";
import { cn } from "@/shared/lib/utils";
import { brand } from "@/config/brand";

/**
 * Product brand lockup: the `h` mark + wordmark.
 *
 * `variant` controls how much of the product name renders alongside the mark, matching the spec's
 * "full product name on external surfaces, short label in-app" rule:
 *  - `full`    - `soletrade Workspace` (external: marketing, auth, onboarding, error/not-found, invite)
 *  - `compact` - `workspace`         (in-app sidebar/mobile sheet, where the mark is already visible)
 *  - `mark`    - `h` mark only        (public invoice/quote pages, where the issuing merchant is the
 *               dominant brand and Soletrade must stay subtle/secondary)
 *
 * The wordmark is rendered with Tailwind `lowercase` to match the existing lowercase wordmark
 * theme; the source strings in `brand` stay title-case (the canonical values used by metadata).
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
    variant === "full" ? brand.productName : variant === "compact" ? brand.shortProductName : null;
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
      {wordmark ? <span className="lowercase">{wordmark}</span> : null}
    </span>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}
