import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { brand } from "@/config/brand";
import { loadAssistantUsage } from "@/features/assistant/api/usage";
import type {
  AssistantUsageMonth,
  AssistantUsageOverview,
  AssistantUsageTotals,
} from "@/server/application/assistant/usage";

/**
 * Settings card: what the assistant has used in this workspace this month, by feature,
 * and in the two months before. Server components, no client JavaScript.
 *
 * Usage is shown to the people who manage the workspace's billing (owners and admins);
 * for everyone else `UsageCard` renders nothing. The numbers are token counts. There is
 * no price table yet, so the card does not show money and nothing here is a limit.
 */

const FEATURE_LABELS: Record<string, string> = {
  chat: "Chat",
  title: "Conversation titles",
  receipt: "Receipt scans",
};

/** A feature the card has no name for yet is shown by its own name, tidied. */
function featureLabel(feature: string): string {
  const known = FEATURE_LABELS[feature];
  if (known) return known;
  const words = feature.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const count = new Intl.NumberFormat("en-AU");

/** "November 2026" for "2026-11". The month is a UTC calendar month, so it is formatted as one. */
function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year ?? 1970, (monthNumber ?? 1) - 1, 1)));
}

/** The share of input served from the prompt cache, or a dash when there was no input. */
function cacheShare(totals: AssistantUsageTotals): string {
  if (totals.inputTokens <= 0) return "-";
  const share = Math.min(1, Math.max(0, totals.cacheReadTokens / totals.inputTokens));
  return `${Math.round(share * 100)}%`;
}

const used = (month: AssistantUsageMonth) => month.totals.calls > 0;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</dd>
      {hint ? <dd className="mt-1 text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

const headCell = "py-2 pr-4 font-medium";
const numberHead = `${headCell} text-right`;
const numberCell = "py-2 pr-4 text-right font-mono tabular-nums";

function TotalsCells({ totals }: { totals: AssistantUsageTotals }) {
  return (
    <>
      <td className={numberCell}>{count.format(totals.inputTokens)}</td>
      <td className={numberCell}>{count.format(totals.outputTokens)}</td>
      <td className={numberCell}>{cacheShare(totals)}</td>
    </>
  );
}

function UsageCardFrame({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Usage</CardTitle>
        <CardDescription>
          What {brand.assistantName} has used in this workspace, in tokens: the units models read
          and write text in. Months are calendar months in UTC.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">{children}</CardContent>
    </Card>
  );
}

/**
 * The card itself, from loaded data. Split from the loader so it can be rendered in a test.
 * `usage` is null when the ledger could not be read.
 */
export function UsageCardView({ usage }: { usage: AssistantUsageOverview | null }) {
  if (!usage) {
    return (
      <UsageCardFrame>
        <p className="text-sm text-muted-foreground">
          Usage can&apos;t be shown right now. Try again in a moment.
        </p>
      </UsageCardFrame>
    );
  }
  const { current, previous } = usage;
  const anything = used(current) || previous.some(used);

  return (
    <UsageCardFrame>
      {!anything ? (
        <p className="text-sm text-muted-foreground">
          Nothing used yet. Usage appears here after the first conversation with{" "}
          {brand.assistantName}.
        </p>
      ) : (
        <>
          <section aria-labelledby="hai-usage-current" className="space-y-4">
            <h3 id="hai-usage-current" className="text-sm font-medium">
              This month, {monthLabel(current.month)}
            </h3>
            {!used(current) ? (
              <p className="text-sm text-muted-foreground">Nothing used so far this month.</p>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat label="Requests" value={count.format(current.totals.calls)} />
                  <Stat label="Input tokens" value={count.format(current.totals.inputTokens)} />
                  <Stat label="Output tokens" value={count.format(current.totals.outputTokens)} />
                  <Stat
                    label="Input from cache"
                    value={cacheShare(current.totals)}
                    hint="Repeated input the provider reused."
                  />
                </dl>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      Usage in {monthLabel(current.month)} by feature
                    </caption>
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th scope="col" className={headCell}>
                          Feature
                        </th>
                        <th scope="col" className={numberHead}>
                          Requests
                        </th>
                        <th scope="col" className={numberHead}>
                          Input tokens
                        </th>
                        <th scope="col" className={numberHead}>
                          Output tokens
                        </th>
                        <th scope="col" className={numberHead}>
                          From cache
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.features.map((feature) => (
                        <tr key={feature.feature} className="border-b last:border-0">
                          <th scope="row" className="py-2 pr-4 text-left font-normal">
                            {featureLabel(feature.feature)}
                          </th>
                          <td className={numberCell}>{count.format(feature.calls)}</td>
                          <TotalsCells totals={feature} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section aria-labelledby="hai-usage-previous" className="space-y-4">
            <h3 id="hai-usage-previous" className="text-sm font-medium">
              Earlier months
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Usage in the two months before</caption>
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className={headCell}>
                      Month
                    </th>
                    <th scope="col" className={numberHead}>
                      Requests
                    </th>
                    <th scope="col" className={numberHead}>
                      Input tokens
                    </th>
                    <th scope="col" className={numberHead}>
                      Output tokens
                    </th>
                    <th scope="col" className={numberHead}>
                      From cache
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {previous.map((month) => (
                    <tr key={month.month} className="border-b last:border-0">
                      <th scope="row" className="py-2 pr-4 text-left font-normal">
                        {monthLabel(month.month)}
                      </th>
                      <td className={numberCell}>{count.format(month.totals.calls)}</td>
                      <TotalsCells totals={month.totals} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </UsageCardFrame>
  );
}

/** The Usage card for the settings page, or nothing for people who do not manage billing. */
export async function UsageCard() {
  const data = await loadAssistantUsage();
  if (!data.access) return null;
  return <UsageCardView usage={data.usage} />;
}
