"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/shared/ui/button";
import { acceptInvitationAction, type AcceptInvitationResult } from "./actions";

const initialState: AcceptInvitationResult = { ok: false, error: "" };

export function InviteAcceptForm({ token }: { token: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    async (_prev: AcceptInvitationResult, formData: FormData): Promise<AcceptInvitationResult> =>
      acceptInvitationAction({ token: String(formData.get("token") ?? "") }),
    initialState,
  );

  // On success the action redirects server-side; this effect is a fallback for the rare case
  // the redirect response didn't propagate (it shouldn't fire under normal flow).
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  const error = !state.ok ? state.error : "";

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Accepting…" : "Accept invitation"}
      </Button>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
