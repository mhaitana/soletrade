"use client";

import { useEffect, useActionState, useRef, useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import {
  inviteMemberAction,
  removeMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
  updateMemberRoleAction,
  type InviteMemberResult,
  type MembersPageData,
} from "@/features/members/api/members";
import {
  HaiPrefillNotice,
  fieldString,
  useHaiFormPrefill,
} from "@/components/assisted-form/hai-form-prefill";

const ROLE_OPTIONS = ["admin", "manager", "accountant", "employee", "readonly"] as const;
const initialState: InviteMemberResult = { ok: false, error: "" };
// Explicit numeric fields and UTC keep Node and WebKit hydration output identical.
const memberDateFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

/** Roles a member can be changed to (excludes owner - ownership transfer is separate). */
const CHANGEABLE_ROLES = ROLE_OPTIONS;

function roleLabel(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

type ConfirmTarget =
  | { kind: "remove"; userId: string; label: string }
  | { kind: "role"; userId: string; label: string; role: string }
  | { kind: "revoke"; invitationId: string; label: string };

function confirmCopy(target: ConfirmTarget | null) {
  if (!target) {
    return {
      title: "",
      description: "",
      action: "Confirm",
      pending: "Working…",
      destructive: false,
    };
  }
  switch (target.kind) {
    case "remove":
      return {
        title: "Remove member?",
        description: `This removes ${target.label} from the workspace. They will lose access immediately. The audit log keeps a record.`,
        action: "Remove",
        pending: "Removing…",
        destructive: true,
      };
    case "role":
      return {
        title: "Change role?",
        description: `Change ${target.label} to ${roleLabel(target.role)}? Their access updates immediately.`,
        action: "Change role",
        pending: "Changing…",
        destructive: false,
      };
    case "revoke":
      return {
        title: "Revoke invitation?",
        description: `The invite link sent to ${target.label} will stop working. You can invite them again later.`,
        action: "Revoke invitation",
        pending: "Revoking…",
        destructive: true,
      };
  }
}

export function MembersManager({ initial }: { initial: MembersPageData }) {
  const router = useRouter();
  const inviteFormRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

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
    if (inviteState.ok) {
      toast.success("Invite sent");
      router.refresh();
    }
  }, [inviteState, router]);

  function closeConfirm() {
    if (isPending) return;
    setConfirmTarget(null);
    setConfirmError(null);
  }

  function runConfirmed() {
    const target = confirmTarget;
    if (!target) return;
    setConfirmError(null);
    startTransition(async () => {
      let res: { ok: true } | { ok: false; error: string };
      try {
        if (target.kind === "remove") {
          res = await removeMemberAction({ userId: target.userId });
        } else if (target.kind === "role") {
          res = await updateMemberRoleAction({ userId: target.userId, role: target.role });
        } else {
          res = await revokeInvitationAction({ invitationId: target.invitationId });
        }
      } catch {
        setConfirmError("We couldn’t confirm whether that went through. Refresh and check.");
        return;
      }
      if (!res.ok) {
        setConfirmError(res.error);
        return;
      }
      toast.success(
        target.kind === "remove"
          ? "Member removed"
          : target.kind === "role"
            ? "Role changed"
            : "Invitation revoked",
      );
      setConfirmTarget(null);
      router.refresh();
    });
  }

  function resend(invitationId: string) {
    setRemoveError(null);
    startTransition(async () => {
      const res = await resendInvitationAction({ invitationId });
      if (!res.ok) {
        setRemoveError(res.error);
        return;
      }
      toast.success("Invitation resent");
      router.refresh();
    });
  }

  const copy = confirmCopy(confirmTarget);
  const inviteError = !inviteState.ok ? inviteState.error : "";
  const inviteFieldErrors = !inviteState.ok ? inviteState.fieldErrors : undefined;
  const haiNotice = useHaiFormPrefill("settings.member-invite", (fields) => {
    const applied: string[] = [];
    const email = fieldString(fields, "email");
    const role = fieldString(fields, "role");
    const emailControl = inviteFormRef.current?.elements.namedItem("email");
    const roleControl = inviteFormRef.current?.elements.namedItem("role");
    if (email && emailControl instanceof HTMLInputElement) {
      emailControl.value = email;
      applied.push("email");
    }
    if (role && roleControl instanceof HTMLSelectElement) {
      roleControl.value = role;
      applied.push("role");
    }
    return { appliedFields: applied };
  });

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
              They&apos;ll receive a single-use invite link by email, valid for 7 days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HaiPrefillNotice notice={haiNotice} className="mb-4" />
            <form
              ref={inviteFormRef}
              action={inviteAction}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
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
                  className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9"
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
              initial.members.map((m) => {
                const isOwner = m.userId === initial.ownerId;
                const isSelf = m.userId === initial.currentUserId;
                const canChangeRole =
                  initial.canManage && !isOwner && !isSelf && m.role !== "owner";
                return (
                  <div key={m.userId} className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {m.email || "(no email)"}
                        {isSelf ? <span className="text-muted-foreground"> (you)</span> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Member since {memberDateFormatter.format(new Date(m.createdAt))}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {canChangeRole ? (
                        <select
                          value={m.role}
                          onChange={(e) => {
                            if (e.target.value === m.role) return;
                            setConfirmError(null);
                            setConfirmTarget({
                              kind: "role",
                              userId: m.userId,
                              label: m.email || m.userId,
                              role: e.target.value,
                            });
                          }}
                          disabled={isPending}
                          aria-label={`Change role for ${m.email || m.userId}`}
                          className="h-11 rounded-md border border-input bg-background px-2 text-sm capitalize ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9"
                        >
                          {CHANGEABLE_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Badge variant="secondary" className="capitalize">
                          {roleLabel(m.role)}
                        </Badge>
                      )}
                      {initial.canManage && !isOwner ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() => {
                            setConfirmError(null);
                            setConfirmTarget({
                              kind: "remove",
                              userId: m.userId,
                              label: m.email || m.userId,
                            });
                          }}
                          aria-label={`Remove ${m.email || m.userId}`}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })
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
                      Expires {memberDateFormatter.format(new Date(inv.expiresAt))}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {roleLabel(inv.role)}
                    </Badge>
                    {initial.canManage ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() => void resend(inv.id)}
                          aria-label={`Resend invitation to ${inv.email}`}
                        >
                          Resend
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() => {
                            setConfirmError(null);
                            setConfirmTarget({
                              kind: "revoke",
                              invitationId: inv.id,
                              label: inv.email,
                            });
                          }}
                          aria-label={`Revoke invitation to ${inv.email}`}
                          className="text-destructive focus:text-destructive"
                        >
                          Revoke
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <ResponsiveDialog
        open={confirmTarget !== null}
        onOpenChange={(o) => {
          if (!o) closeConfirm();
        }}
      >
        <ResponsiveDialogContent aria-busy={isPending}>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{copy.title}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{copy.description}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {confirmError ? (
            <p className="text-sm text-destructive" role="alert">
              {confirmError}
            </p>
          ) : null}
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={closeConfirm} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant={copy.destructive ? "destructive" : "default"}
              disabled={isPending}
              onClick={runConfirmed}
            >
              {isPending ? copy.pending : copy.action}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
