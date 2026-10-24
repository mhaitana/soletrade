"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Workspace = { workspaceId: string; name: string; role: string };
export function DeletionForm({ workspaces, email }: { workspaces: Workspace[]; email: string }) {
  const [closed, setClosed] = useState<string[]>([]),
    [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [complete, setComplete] = useState(false);
  const owned = workspaces.filter((workspace) => workspace.role === "owner");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const client = createSupabaseBrowserClient();
      const session = (await client.auth.getSession()).data.session;
      if (!session) throw new Error("Sign in again before requesting deletion.");
      const response = await fetch("/api/v1/me/deletion", {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ confirmation, closeWorkspaceIds: closed }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Could not request deletion.");
      await client.auth.signOut({ scope: "local" });
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not request deletion.");
    } finally {
      setPending(false);
    }
  }
  if (complete)
    return <p role="status">Your account is closed. Deletion is scheduled within 30 days.</p>;
  return (
    <form onSubmit={submit} className="space-y-5 rounded-lg border border-border p-5">
      <h2 className="text-lg font-semibold">Confirm account deletion</h2>
      <p className="text-sm">
        Signed in as {email}. Confirm with a recent password or email-link sign-in. This request
        cannot be undone.
      </p>
      {owned.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-medium">Workspaces you own</legend>
          {owned.map((workspace) => (
            <label key={workspace.workspaceId} className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={closed.includes(workspace.workspaceId)}
                onChange={(event) =>
                  setClosed(
                    event.target.checked
                      ? [...closed, workspace.workspaceId]
                      : closed.filter((id) => id !== workspace.workspaceId),
                  )
                }
              />
              Close {workspace.name} and delete its content within 30 days
            </label>
          ))}
          <p className="text-sm text-muted-foreground">
            For shared workspaces, transfer ownership in the mobile app and wait for the recipient
            to accept before returning here.{" "}
            <Link className="underline" href="/settings/members">
              Review your team
            </Link>
            .
          </p>
        </fieldset>
      )}
      <div className="space-y-2">
        <Label htmlFor="delete-confirmation">Type DELETE to confirm</Label>
        <Input
          id="delete-confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}{" "}
          <Link className="underline" href="/login?next=%2Fdelete-account">
            Sign in again
          </Link>
        </p>
      )}
      <Button
        type="submit"
        variant="destructive"
        disabled={
          pending ||
          confirmation !== "DELETE" ||
          owned.some((workspace) => !closed.includes(workspace.workspaceId))
        }
      >
        {pending ? "Closing account…" : "Delete my account"}
      </Button>
    </form>
  );
}
