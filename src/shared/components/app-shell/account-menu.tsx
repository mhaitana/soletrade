"use client";

import Link from "next/link";
import { LogOut, Settings, User } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { signOutAction } from "@/app/(app)/actions/auth";

export function AccountMenu({ userEmail }: { userEmail: string }) {
  const initial = (userEmail.charAt(0) || "A").toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account" className="text-muted-foreground">
          <span className="grid size-6 place-items-center rounded-full bg-muted text-xs font-semibold">
            {initial}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{userEmail || "Signed in"}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings" className="gap-2 text-sm">
            <Settings className="size-4" aria-hidden />
            <span>Settings</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/members" className="gap-2 text-sm">
            <User className="size-4" aria-hidden />
            <span>Members</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await signOutAction();
          }}
          className="gap-2 text-sm text-destructive focus:text-destructive"
        >
          <LogOut className="size-4" aria-hidden />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
