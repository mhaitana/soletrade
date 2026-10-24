"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchWorkspaceAction } from "@/features/workspaces/api/workspaces";
import { cn } from "@/lib/utils";
import type { WorkspaceRole } from "@/lib/domain/database-enums";
import type { WorkspaceId } from "@/types/ids";

export type WorkspaceOption = {
  id: WorkspaceId;
  name: string;
  slug: string;
  role: WorkspaceRole;
};

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  showOnMobile = false,
}: {
  workspaces: WorkspaceOption[];
  activeWorkspaceId: WorkspaceId;
  /**
   * When true the trigger drops its `hidden md:flex` gate so the switcher is
   * visible on mobile (used inside the mobile nav Sheet). Default keeps it
   * desktop-only so it never collides with the mobile top bar.
   */
  showOnMobile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];

  function select(id: WorkspaceId) {
    setOpen(false);
    startTransition(async () => {
      const res = await switchWorkspaceAction({ workspaceId: id });
      if (!res.ok) {
        // Rare (membership revoked mid-session); refresh so the shell re-syncs.
        window.location.reload();
      }
    });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label="Switch workspace"
          disabled={isPending}
          className={cn(
            "gap-2 px-2 text-sm font-medium",
            showOnMobile ? "flex w-full justify-start" : "hidden md:flex",
          )}
        >
          <span className="grid size-6 place-items-center rounded bg-primary text-xs font-semibold text-primary-foreground">
            {(active?.name ?? "W").charAt(0).toUpperCase()}
          </span>
          <span className="max-w-[8rem] truncate">{active?.name ?? "No workspace"}</span>
          <ChevronsUpDown className="size-4 opacity-50" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((w) => (
          <DropdownMenuItem
            key={w.id}
            onSelect={(e) => {
              e.preventDefault();
              select(w.id);
            }}
            className="gap-2"
          >
            <span className="grid size-6 place-items-center rounded bg-muted text-xs font-semibold">
              {w.name.charAt(0).toUpperCase()}
            </span>
            <span className="flex-1 truncate text-sm">{w.name}</span>
            {w.id === activeWorkspaceId ? (
              <Check className="size-4 opacity-60" aria-hidden />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding" className="gap-2 text-sm">
            <Plus className="size-4" aria-hidden />
            <span>Create workspace</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
