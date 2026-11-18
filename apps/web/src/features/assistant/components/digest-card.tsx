"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setDigestFrequencyAction, type DigestSettingsData } from "@/features/assistant/api/digest";
import type { AiDigestFrequency } from "@/lib/domain/database-enums";

const OPTIONS: { value: AiDigestFrequency; label: string; description: string }[] = [
  { value: "off", label: "Off", description: "Nothing is sent." },
  { value: "daily", label: "Daily", description: "Every morning." },
  { value: "weekly", label: "Weekly", description: "Monday mornings only." },
];

/**
 * Briefing digest setting for the signed-in member in this workspace. Off until they choose
 * otherwise, and each member chooses only for themselves.
 */
export function DigestCard({ initial }: { initial: DigestSettingsData }) {
  const [saved, setSaved] = useState<AiDigestFrequency>(initial.frequency);
  const [selected, setSelected] = useState<AiDigestFrequency>(initial.frequency);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function save(): void {
    setError("");
    startTransition(async () => {
      const result = await setDigestFrequencyAction({ frequency: selected });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(result.frequency);
      toast.success(
        result.frequency === "off" ? "Briefing digest turned off" : "Briefing digest saved",
      );
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Briefing digest</CardTitle>
        <CardDescription>
          A short summary of what needs your attention in {initial.workspaceName}, such as overdue
          invoices and receipts to review, sent to your notifications and to {initial.email} after
          7:00 am ({initial.timezone} time), and never when there is nothing to report.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <fieldset className="space-y-2" disabled={pending}>
            <legend className="sr-only">How often to send the briefing digest</legend>
            {OPTIONS.map((option) => {
              const id = `digest-frequency-${option.value}`;
              const checked = selected === option.value;
              return (
                <label
                  key={option.value}
                  htmlFor={id}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                    checked ? "border-primary bg-accent/40" : "border-border hover:bg-accent/20"
                  }`}
                >
                  <input
                    id={id}
                    type="radio"
                    name="digest-frequency"
                    value={option.value}
                    checked={checked}
                    onChange={() => setSelected(option.value)}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending || selected === saved}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
