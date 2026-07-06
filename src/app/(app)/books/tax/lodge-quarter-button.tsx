"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { lodgeTaxPeriodAction } from "./actions";

/**
 * "Lodge this quarter" button — calls `lodgeTaxPeriodAction` with the current
 * financial-year quarter. Mirrors `book-detail-actions.tsx`: `useTransition` for
 * the pending state, local error state. The server action is fail-closed on
 * `manage:books` (the page only renders this button when `canManage`).
 */
export function LodgeQuarterButton({
  fiscalYear,
  quarter,
  label,
}: {
  fiscalYear: number;
  quarter: number;
  label: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string>("");
  const [done, setDone] = useState(false);

  function onLodge() {
    setError("");
    startTransition(async () => {
      const res = await lodgeTaxPeriodAction({ fiscalYear, quarter });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {label} lodged. The snapshot is locked in the lodged-periods list below.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Button onClick={onLodge} disabled={isPending}>
        {isPending ? "Lodging…" : `Lodge ${label}`}
      </Button>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
