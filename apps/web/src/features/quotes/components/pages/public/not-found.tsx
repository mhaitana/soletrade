import { Logo } from "@/components/logo";

export const metadata = { title: "Quote not available", robots: { index: false, follow: false } };

/**
 * Shown when a customer opens a quote link that does not resolve. The generic site 404
 * ("Page not found - Go home") sent them to the marketing site with no idea what to do
 * next; this says what happened and who can help.
 */
export default function PublicQuoteNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 text-center text-foreground">
      <div className="max-w-md space-y-3">
        <Logo variant="mark" href={null} className="mx-auto" />
        <h1 className="text-2xl font-semibold tracking-tight">
          This quote link isn&apos;t available
        </h1>
        <p className="text-sm text-muted-foreground">
          The link may be incomplete, or the quote may have been withdrawn or replaced. Please ask
          the business that sent it to you for a new link.
        </p>
      </div>
    </main>
  );
}
