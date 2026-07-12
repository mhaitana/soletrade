import { brand } from "@/config/brand";

/**
 * Shared shell for the public legal/support pages (/privacy, /terms, /support).
 *
 * Mirrors the marketing hero rhythm (eyebrow + balanced title) but left-aligned for
 * long-form reading, capped at `max-w-3xl`, with a "Last updated" meta line. Legal
 * body text uses `text-foreground` (ink-on-paper) rather than `muted-foreground` so
 * long passages stay readable; `muted-foreground` is reserved for meta + the
 * review-note callout.
 */

export function LegalPage({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 md:px-8 md:py-24">
      <p className="text-sm font-medium text-brand-blue">{brand.productName}</p>
      <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight md:text-5xl">
        {title}
      </h1>
      {lastUpdated ? (
        <p className="mt-3 text-sm text-muted-foreground">Last updated {lastUpdated}</p>
      ) : null}
      <div className="mt-10 space-y-8">{children}</div>
    </div>
  );
}

/** A titled section within a legal page. */
export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-foreground">{children}</div>
    </section>
  );
}

/**
 * Callout flagging that the page content is a template pending legal review before
 * launch — so templated copy is never mistaken for final, binding text.
 */
export function LegalReviewNote() {
  return (
    <p className="rounded-md border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
      This page is a template. Have it reviewed by a qualified professional before relying on it
      in production.
    </p>
  );
}