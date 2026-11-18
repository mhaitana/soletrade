import Link from "next/link";
import { ArrowRight, Newspaper } from "lucide-react";
import { AskHaiButton } from "@/components/ask-hai-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BriefingCardData } from "@/features/dashboard/api/actions";

/** What the card's Ask hAI button sends, as a new conversation. */
const ASK_QUESTION = "What should I pay attention to today?";

/**
 * Briefing card at the top of the dashboard. Server component; the Ask hAI button is its
 * only client part. It shows the headline the loader built from the member's insight facts,
 * when those facts were read, and a link to each list the headline mentions. With nothing
 * waiting it shows the one "nothing to report" sentence and no links.
 *
 * The headline is composed by fixed rules from database figures, never by a model. Asking
 * hAI is a separate, explicit step: the button opens the hAI panel with a question and the
 * answer appears there, not in this card.
 */
export function BriefingCard({ briefing }: { briefing: BriefingCardData }) {
  return (
    <section aria-labelledby="briefing-heading">
      <Card className="gap-3 py-5 max-sm:py-4">
        <CardHeader className="max-sm:px-4">
          <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base">
            <Newspaper className="size-4 text-primary" aria-hidden />
            <h2 id="briefing-heading" className="text-base font-semibold">
              Briefing
            </h2>
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              As of <time dateTime={briefing.asOf}>{briefing.asOfLabel}</time>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 max-sm:px-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <p className="text-sm leading-6 text-foreground">{briefing.headline}</p>
            <AskHaiButton question={ASK_QUESTION} size="sm" className="self-start" />
          </div>
          {briefing.links.length > 0 ? (
            <ul className="flex flex-wrap gap-x-5 gap-y-2 max-md:gap-y-0">
              {briefing.links.map((link) => (
                <li key={link.id}>
                  <Link
                    href={link.href}
                    className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-brand-blue outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40 max-md:min-h-11"
                  >
                    {link.label}
                    <ArrowRight className="size-3" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
