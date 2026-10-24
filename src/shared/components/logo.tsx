import Link from "next/link";
import Image from "next/image";
import { cn } from "@/shared/lib/utils";
import { brand } from "@/config/brand";
import { pwaBrand } from "@/config/pwa";

/**
 * Product lockup using the same HB artwork as the installed app.
 *
 * Full labels name Soletrade, compact labels use Business in the app shell,
 * and mark-only variants keep merchant branding dominant on public documents.
 * Matt Haitana remains the parent company in copyright and publisher metadata.
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
      <Image
        src={pwaBrand.icons.standard192}
        alt=""
        width={32}
        height={32}
        className="size-8 shrink-0"
        loading="eager"
        unoptimized
      />
      {wordmark ? <span className="whitespace-nowrap">{wordmark}</span> : null}
    </span>
  );
  return href ? (
    <Link href={href} aria-label={brand.productName}>
      {content}
    </Link>
  ) : (
    content
  );
}
