"use client";

import { useEffect, useActionState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { createWorkspaceAction, type CreateWorkspaceResult } from "@/app/(app)/actions/workspaces";

const initialState: CreateWorkspaceResult = { ok: false, error: "" };

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    async (_prev: CreateWorkspaceResult, formData: FormData): Promise<CreateWorkspaceResult> => {
      return createWorkspaceAction({
        name: String(formData.get("name") ?? ""),
        slug: String(formData.get("slug") ?? ""),
      });
    },
    initialState,
  );

  useEffect(() => {
    if (state.ok) router.push("/dashboard");
  }, [state, router]);

  const error = !state.ok ? state.error : "";
  const fieldErrors = !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Workspace name</Label>
        <Input
          id="name"
          name="name"
          placeholder="Acme Trading"
          required
          maxLength={80}
          aria-invalid={Boolean(fieldErrors?.name)}
        />
        {fieldErrors?.name?.[0] ? (
          <p className="text-sm text-destructive">{fieldErrors.name[0]}</p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="slug">Slug</Label>
        <Input
          id="slug"
          name="slug"
          placeholder="acme-trading"
          required
          maxLength={40}
          pattern="[a-z0-9-]+"
          aria-invalid={Boolean(fieldErrors?.slug)}
        />
        <p className="text-xs text-muted-foreground">Lowercase letters, numbers, hyphens.</p>
        {fieldErrors?.slug?.[0] ? (
          <p className="text-sm text-destructive">{fieldErrors.slug[0]}</p>
        ) : null}
      </div>
      {error && !fieldErrors ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Creating…" : "Create workspace"}
      </Button>
    </form>
  );
}
