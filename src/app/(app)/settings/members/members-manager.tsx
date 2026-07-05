"use client";

import { useEffect, useActionState, useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import {
  inviteMemberAction,
  removeMemberAction,
  type InviteMemberResult,
  type MembersPageData,
} from "@/app/(app)/actions/members";

const ROLE_OPTIONS = ["admin", "manager", "accountant", "employee", "readonly"] as const;
const initialState: InviteMemberResult = { ok: false, error: "" };

function roleLabel(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function MembersManager({ initial }: { initial: MembersPageData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [inviteState, inviteAction, invitePending] = useActionState(
    async (_prev: InviteMemberResult, formData: FormData): Promise<InviteMemberResult> => {
      return inviteMemberAction({
        email: String(formData.get("email") ?? ""),
        role: String(formData.get("role") ?? ""),
      });
    },
    initialState,
  );

  useEffect(() => {
    if (inviteState.ok) router.refresh();
  }, [inviteState, router]);

  function remove(userId: string) {
    setRemoveError(null);
    startTransition(async () => {
      const res = await removeMemberAction({ userId });
      if (!res.ok) {
        setRemoveError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const inviteError = !inviteState.ok ? inviteState.error : "";
  const inviteFieldErrors = !inviteState.ok ? inviteState.fieldErrors : undefined;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-sm text-muted-foreground">Invite teammates and manage their access.</p>
      </div>

      {initial.canInvite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite a member</CardTitle>
            <CardDescription>
              They&apos;ll receive a single-use invite link valid for 7 days. Email delivery is
              wired in Phase 18.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={inviteAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  required
                  placeholder="teammate@example.com"
                  aria-invalid={Boolean(inviteFieldErrors?.email)}
                />
                {inviteFieldErrors?.email?.[0] ? (
                  <p className="text-sm text-destructive">{inviteFieldErrors.email[0]}</p>
                ) : null}
              </div>
              <div className="space-y-1.5 sm:w-40">
                <Label htmlFor="invite-role">Role</Label>
                <select
                  id="invite-role"
                  name="role"
                  defaultValue="employee"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={invitePending}>
                {invitePending ? "Sending…" : "Send invite"}
              </Button>
            </form>
            {inviteError && !inviteFieldErrors ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {inviteError}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-lg font-medium">Members</h2>
        {removeError ? (
          <p className="text-sm text-destructive" role="alert">
            {removeError}
          </p>
        ) : null}
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {initial.members.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No members yet.</p>
            ) : (
              initial.members.map((m) => (
                <div key={m.userId} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.email || "(no email)"}</p>
                    <p className="text-xs text-muted-foreground">
                      Member since {new Date(m.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary" className="capitalize">
                      {roleLabel(m.role)}
                    </Badge>
                    {initial.canManage ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isPending}
                        onClick={() => void remove(m.userId)}
                        aria-label={`Remove ${m.email || m.userId}`}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {initial.invitations.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-lg font-medium">Pending invitations</h2>
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {initial.invitations.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Expires {new Date(inv.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {roleLabel(inv.role)}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
