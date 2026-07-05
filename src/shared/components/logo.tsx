import Link from "next/link";
import { cn } from "@/shared/lib/utils";

export function Logo({ className, href = "/" }: { className?: string; href?: string | null }) {
  const content = (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
      >
        h
      </span>
      <span>soletrade labs</span>
    </span>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}
