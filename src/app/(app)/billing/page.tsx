import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { MODULES } from "@/shared/constants/modules";
import { formatCents } from "@/platform/billing";
import { loadBillingOverview } from "./actions";
import { BillingStartCard } from "./billing-start-card";
import { BillingManageActions } from "./billing-manage-actions";

export const metadata = { title: "Billing" };

const entryTypeLabel: Record<string, string> = {
  grant: "Grant",
  consumption: "Consumption",
  refund: "Refund",
  adjustment: "Adjustment",
  promotion: "Promotion",
  expired: "Expired",
};

const intervalLabel: Record<string, string> = {
  monthly: "Monthly",
  annual: "Annual",
};

const suffixFor = (interval: string) => (interval === "annual" ? "/yr" : "/mo");

export default async function BillingPage() {
  const data = await loadBillingOverview();
  const balanceClass = data.balanceCents < 0 ? "text-destructive" : "text-success";
  const interval = data.currentPricing.interval;
  const suffix = suffixFor(interval);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground">
            Your billing state, credit balance, and recent ledger activity.
          </p>
        </div>
        {data.canManage && data.hasActiveBilling ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/settings/modules">Manage modules</Link>
            </Button>
            <BillingManageActions interval={data.billingInterval} />
          </div>
        ) : null}
      </div>

      {/* Billing state + credit summary */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Billing</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              {data.billingInterval ? (
                <span>{intervalLabel[data.billingInterval]}</span>
              ) : (
                <span>Not started</span>
              )}
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
              <p>Start billing to enable paid modules.</p>
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

      {/* Start-billing card OR current pricing breakdown */}
      {data.hasActiveBilling ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current pricing</CardTitle>
            <CardDescription>
              {data.currentPricing.anchorKey
                ? `${MODULES[data.currentPricing.anchorKey].name} is your anchor app (full price); the rest are add-ons.`
                : "No modules installed."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.currentPricing.modules.length === 0 ? (
              <p className="text-muted-foreground">
                No modules billed. Enable modules from{" "}
                <Link href="/settings/modules" className="text-primary hover:underline">
                  module settings
                </Link>
                .
              </p>
            ) : (
              <>
                {data.currentPricing.modules.map((m) => (
                  <div key={m.key} className="flex justify-between">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      {MODULES[m.key].name}
                      <Badge
                        variant={m.role === "standalone" ? "default" : "outline"}
                        className="capitalize"
                      >
                        {m.role === "standalone" ? "Anchor" : "Add-on"}
                      </Badge>
                    </span>
                    <span className="tabular-nums">
                      {formatCents(m.netCents, data.currency)}
                      {suffix}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between border-t pt-2 font-medium">
                  <span>Total</span>
                  <span className="tabular-nums">
                    {formatCents(data.currentPricing.totalCents, data.currency)}
                    {suffix}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : data.canManage ? (
        <BillingStartCard />
      ) : null}

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
                    const amountClass = amount < 0 ? "text-destructive" : "text-success";
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
        Manage your modules from{" "}
        <Link href="/settings/modules" className="text-primary hover:underline">
          module settings
        </Link>
        . See{" "}
        <Link href="/pricing" className="text-primary hover:underline">
          public pricing
        </Link>{" "}
        for plan details. Cancelling your subscription refunds unused time in the current period to
        your credit balance, pro-rated per module; switching interval takes effect next cycle.
      </p>
    </div>
  );
}
