"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { signOutAction } from "@/app/(app)/actions/auth";

/**
 * Signs the admin out of their Supabase auth session and redirects to /login.
 * Rendered in the AdminShell sidebar footer and the mobile nav drawer. Reuses the
 * shared `signOutAction` (same one the app AccountMenu uses) so admin and member
 * sign-out behave identically.
 */
export function AdminSignOutButton({ className }: { className?: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      disabled={pending}
      onClick={() => startTransition(() => signOutAction())}
    >
      <LogOut className="size-4" />
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
