import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Sparkline } from "@/shared/components/sparkline";
import { MODULES } from "@/shared/constants/modules";
import type { ModuleCardData } from "./actions";

/**
 * Per-module summary card for the cross-module dashboard (Phase 9). Server component. One card
 * per **enabled** module (gated by `getInstalledModules` in the loader) - disabled modules don't
 * get a card; the zero-module case is handled by the page's onboarding branch.
 *
 * Renders the module icon + name (looked up from the shared `MODULES` registry so the card data
 * stays serializable - no component references cross the server-action boundary), the period's
 * monthly `<Sparkline>`, 2-3 key metrics (`tabular-nums`), and a "View →" link to the module.
 */
export function ModuleSummaryCard({ card }: { card: ModuleCardData }) {
  const Icon = MODULES[card.key].icon;
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="size-5 text-primary" aria-hidden />
          <span className="font-medium">{card.name}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {card.sparkline ? (
          <Sparkline points={card.sparkline.points} ariaLabel={card.sparkline.ariaLabel} />
        ) : (
          <p className="text-xs text-muted-foreground">No completed activity this period.</p>
        )}
        <dl className="grid grid-cols-3 gap-2">
          {card.metrics.map((m) => (
            <div key={m.label} className="space-y-0.5">
              <dt className="text-xs text-muted-foreground">{m.label}</dt>
              <dd className="text-sm font-medium tabular-nums">{m.value}</dd>
            </div>
          ))}
        </dl>
        <Link
          href={card.href}
          className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline"
        >
          View
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}
