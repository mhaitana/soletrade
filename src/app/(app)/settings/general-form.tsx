"use client";

import { useActionState } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import {
  SUPPORTED_CURRENCIES,
  COMMON_TIMEZONES,
  FINANCIAL_YEAR_START_MONTHS,
} from "@/shared/constants/currencies";
import {
  updateWorkspaceAction,
  type GeneralSettingsPageData,
  type UpdateWorkspaceResult,
} from "@/app/(app)/actions/workspace";

const initialState: UpdateWorkspaceResult = { ok: false, error: "" };

export function GeneralSettingsForm({ initial }: { initial: GeneralSettingsPageData }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: UpdateWorkspaceResult, formData: FormData): Promise<UpdateWorkspaceResult> =>
      updateWorkspaceAction({
        name: String(formData.get("name") ?? ""),
        defaultCurrency: String(formData.get("defaultCurrency") ?? ""),
        invoicePrefix: String(formData.get("invoicePrefix") ?? ""),
        quotePrefix: String(formData.get("quotePrefix") ?? ""),
        timezone: String(formData.get("timezone") ?? ""),
        fyStartMonth: Number(formData.get("fyStartMonth") ?? 7),
      }),
    initialState,
  );

  const selectClass =
    "h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  const error = !state.ok ? state.error : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">General</h1>
        <p className="text-sm text-muted-foreground">
          Workspace name, billing currency, and document numbering.
        </p>
      </div>

      {!initial.canManage ? (
        <p className="rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          Only owners and admins can change workspace settings.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workspace</CardTitle>
          <CardDescription>
            The slug <code className="font-mono text-xs">{initial.workspace.slug}</code> is
            immutable. Renaming only changes the display name.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Workspace name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={initial.workspace.name}
                required
                maxLength={100}
                disabled={!initial.canManage}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="defaultCurrency">Default currency</Label>
              <select
                id="defaultCurrency"
                name="defaultCurrency"
                defaultValue={initial.workspace.defaultCurrency}
                disabled={!initial.canManage}
                className={selectClass}
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Applied to new invoices, quotes, and transactions that don&apos;t specify a
                currency.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="invoicePrefix">Invoice prefix</Label>
                <Input
                  id="invoicePrefix"
                  name="invoicePrefix"
                  defaultValue={initial.workspace.invoicePrefix}
                  maxLength={10}
                  disabled={!initial.canManage}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  e.g. <span className="font-mono">INV-</span> →{" "}
                  <span className="font-mono">INV-2026-0001</span>. Changing it restarts the yearly
                  sequence.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quotePrefix">Quote prefix</Label>
                <Input
                  id="quotePrefix"
                  name="quotePrefix"
                  defaultValue={initial.workspace.quotePrefix}
                  maxLength={10}
                  disabled={!initial.canManage}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  e.g. <span className="font-mono">QUO-</span> →{" "}
                  <span className="font-mono">QUO-2026-0001</span>.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="timezone">Timezone</Label>
              <select
                id="timezone"
                name="timezone"
                defaultValue={initial.workspace.timezone}
                disabled={!initial.canManage}
                className={selectClass}
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Used for date display on the dashboard and lists. Stored dates stay UTC.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fyStartMonth">Financial year starts</Label>
              <select
                id="fyStartMonth"
                name="fyStartMonth"
                defaultValue={String(initial.workspace.fyStartMonth)}
                disabled={!initial.canManage}
                className={selectClass}
              >
                {FINANCIAL_YEAR_START_MONTHS.map((m) => (
                  <option key={m.month} value={String(m.month)}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Anchors the GST/BAS quarter labels and the &quot;This year&quot;/&quot;This
                quarter&quot; dashboard windows. e.g. 1 July (AU), 1 April (NZ), 1 January (calendar
                year).
              </p>
            </div>

            {initial.canManage ? (
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save changes"}
              </Button>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : state.ok ? (
              <p className="text-sm text-muted-foreground">Saved.</p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
