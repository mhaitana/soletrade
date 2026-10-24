"use client";
import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { cancelPendingCheckoutAction } from "./actions";
export function PendingCheckoutActions() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await cancelPendingCheckoutAction();
            if (!result.ok) setError(result.error);
          });
        }}
      >
        {pending ? "Cancelling checkout…" : "Cancel pending checkout"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
