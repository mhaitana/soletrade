"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { updateProfileAction, type UpdateProfileResult } from "@/features/account/api/account";
import {
  HaiPrefillNotice,
  fieldString,
  useHaiFormPrefill,
} from "@/components/assisted-form/hai-form-prefill";

const initialState: UpdateProfileResult = { ok: false, error: "" };

export function AccountForm({
  initialEmail,
  initialFullName,
}: {
  initialEmail: string;
  initialFullName: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    async (_prev: UpdateProfileResult, formData: FormData): Promise<UpdateProfileResult> =>
      updateProfileAction({ fullName: String(formData.get("fullName") ?? "") }),
    initialState,
  );

  const initial = (initialEmail.charAt(0) || "A").toUpperCase();
  const error = !state.ok ? state.error : "";

  useEffect(() => {
    if (state.ok) toast.success("Profile saved");
  }, [state]);
  const haiNotice = useHaiFormPrefill("settings.account", (fields) => {
    const fullName = fieldString(fields, "fullName");
    const control = formRef.current?.elements.namedItem("fullName");
    if (fullName && control instanceof HTMLInputElement) {
      control.value = fullName;
      return { appliedFields: ["full name"] };
    }
    return { appliedFields: [] };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-muted-foreground">Your personal profile.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>The name shown across the workspace to your teammates.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-full bg-muted text-sm font-semibold">
              {initial}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{initialEmail || "Signed in"}</p>
              <p className="text-xs text-muted-foreground">Email address (read-only)</p>
            </div>
          </div>

          <form ref={formRef} action={formAction} className="space-y-3">
            <HaiPrefillNotice notice={haiNotice} />
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Full name</Label>
              <Input
                id="fullName"
                name="fullName"
                defaultValue={initialFullName}
                required
                maxLength={120}
                placeholder="Your name"
              />
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save name"}
            </Button>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : state.ok ? (
              <p role="status" className="text-sm text-muted-foreground">
                Saved.
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
