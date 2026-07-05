import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { MODULES } from "@/shared/constants/modules";
import { formatCents } from "@/platform/billing";
import { loadBillingOverview } from "./actions";
import { BillingUpgradeButton } from "./billing-upgrade-button";

export const metadata = { title: "Billing" };

const entryTypeLabel: Record<string, string> = {
  grant: "Grant",
  consumption: "Consumption",
  refund: "Refund",
  adjustment: "Adjustment",
};

export default async function BillingPage() {
  const data = await loadBillingOverview();
  const balanceClass = data.balanceCents < 0 ? "text-destructive" : "text-[#059669]";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground">
            Your plan, credit balance, and recent ledger activity.
          </p>
        </div>
        {data.canManage && data.tier === "free" ? <BillingUpgradeButton /> : null}
        {data.canManage && data.tier === "pro" ? (
          <Button asChild variant="outline">
            <Link href="/settings/modules">Manage modules</Link>
          </Button>
        ) : null}
      </div>

      {/* Plan + credit summary */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Current plan</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl capitalize">
              {data.tier}
              <Badge variant="secondary" className="capitalize">
                {data.status}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {data.anchorBillingDate ? (
              <p>
                Anchor billing date:{" "}
                <span className="tabular-nums text-foreground">
                  {data.anchorBillingDate.toLocaleDateString()}
                </span>
              </p>
            ) : (
              <p>Upgrade to Pro to enable paid modules.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Credit balance</CardDescription>
            <CardTitle className={`text-2xl tabular-nums ${balanceClass}`}>
              {formatCents(data.balanceCents, data.currency)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>Credits apply to charges and are restored on mid-cycle cancellations.</p>
          </CardContent>
        </Card>
      </div>

      {/* Current pricing breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current pricing</CardTitle>
          <CardDescription>
            {data.tier === "free"
              ? "Free tier — no modules billed."
              : `Pro anchor + ${data.installedModules.length} module${data.installedModules.length === 1 ? "" : "s"}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Pro anchor</span>
            <span className="tabular-nums">
              {formatCents(data.currentPricing.anchorCents, data.currency)}/mo
            </span>
          </div>
          {data.currentPricing.modules.map((m) => (
            <div key={m.key} className="flex justify-between">
              <span className="text-muted-foreground">
                {MODULES[m.key].name}
                {m.discountCents > 0 ? (
                  <Badge variant="outline" className="ml-2 text-muted-foreground">
                    {Math.round((m.discountCents / m.grossCents) * 100)}% off
                  </Badge>
                ) : null}
              </span>
              <span className="tabular-nums">{formatCents(m.netCents, data.currency)}/mo</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-2 font-medium">
            <span>Total</span>
            <span className="tabular-nums">
              {formatCents(data.currentPricing.totalCents, data.currency)}/mo
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Recent ledger */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent ledger</CardTitle>
          <CardDescription>Append-only record of every credit movement.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.recentLedger.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No ledger entries yet. Credits appear here once granted or consumed.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Type
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Reason
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Module
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Amount
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentLedger.map((row) => {
                    const amount = row.amountCents;
                    const amountClass = amount < 0 ? "text-destructive" : "text-[#059669]";
                    return (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="py-2 pr-4">
                          <Badge variant="outline">
                            {entryTypeLabel[row.entryType] ?? row.entryType}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">{row.reason}</td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {row.moduleKey ? MODULES[row.moduleKey].name : "—"}
                        </td>
                        <td className={`py-2 pr-4 text-right tabular-nums ${amountClass}`}>
                          {formatCents(amount, row.currency)}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                          {row.createdAt.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Upgrade to Pro to enable paid modules, then manage them from{" "}
        <Link href="/settings/modules" className="text-primary hover:underline">
          module settings
        </Link>
        . See{" "}
        <Link href="/pricing" className="text-primary hover:underline">
          public pricing
        </Link>{" "}
        for plan details.
      </p>
    </div>
  );
}
