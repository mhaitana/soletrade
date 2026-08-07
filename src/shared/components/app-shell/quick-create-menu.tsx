"use client";

import Link from "next/link";
import { BookOpen, Car, FilePlus2, Plus, Receipt, UserPlus, type LucideIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import type { ModuleKey } from "@/shared/constants/modules";
import { can, type Permission } from "@/platform/permissions";
import type { WorkspaceRole } from "@/server/db/enums";

const MODULE_ACTIONS: Record<
  ModuleKey,
  { href: string; label: string; description: string; icon: LucideIcon; permission: Permission }
> = {
  invoices: {
    href: "/invoices/new",
    label: "New invoice",
    description: "Bill a customer",
    icon: Receipt,
    permission: "create:invoice",
  },
  quotes: {
    href: "/quotes/new",
    label: "New quote",
    description: "Send a proposal",
    icon: FilePlus2,
    permission: "create:quote",
  },
  books: {
    href: "/books/new",
    label: "New transaction",
    description: "Record income or an expense",
    icon: BookOpen,
    permission: "create:books",
  },
  drive: {
    href: "/drive/new",
    label: "New drive entry",
    description: "Log earnings or mileage",
    icon: Car,
    permission: "create:drive",
  },
};

export function QuickCreateMenu({
  installedModules,
  role,
}: {
  installedModules: ModuleKey[];
  role: WorkspaceRole;
}) {
  const availableActions = installedModules
    .map((key) => ({ key, ...MODULE_ACTIONS[key] }))
    .filter((action) => can(role, action.permission));
  const canCreateCustomer = can(role, "create:customer");
  const canEnableModule = can(role, "manage:module");

  if (availableActions.length === 0 && !canCreateCustomer && !canEnableModule) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          aria-label="Create new"
          className="gap-2 px-3 max-sm:size-11 max-sm:px-0"
        >
          <Plus className="size-4" aria-hidden />
          <span className="max-sm:sr-only">New</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Create new</DropdownMenuLabel>
        {availableActions.map((action) => {
          const Icon = action.icon;
          return (
            <DropdownMenuItem key={action.key} asChild className="items-start py-2">
              <Link href={action.href}>
                <Icon className="mt-0.5 size-4" aria-hidden />
                <span>
                  <span className="block font-medium text-foreground">{action.label}</span>
                  <span className="block text-xs text-muted-foreground">{action.description}</span>
                </span>
              </Link>
            </DropdownMenuItem>
          );
        })}
        {availableActions.length > 0 && (canCreateCustomer || canEnableModule) ? (
          <DropdownMenuSeparator />
        ) : null}
        {canCreateCustomer ? (
          <DropdownMenuItem asChild>
            <Link href="/customers/new">
              <UserPlus className="size-4" aria-hidden />
              New customer
            </Link>
          </DropdownMenuItem>
        ) : null}
        {canEnableModule ? (
          <>
            {canCreateCustomer ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem asChild>
              <Link href="/settings/modules">
                {installedModules.length === 0 ? "Enable a business module" : "Manage modules"}
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
