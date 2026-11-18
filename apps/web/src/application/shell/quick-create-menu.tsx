"use client";

import Link from "next/link";
import { Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ModuleKey } from "@/config/modules";
import { buildModuleCreateActions } from "@/config/navigation";
import { can } from "@/lib/domain/permissions/index";
import type { WorkspaceRole } from "@/lib/domain/database-enums";

export function QuickCreateMenu({
  installedModules,
  role,
}: {
  installedModules: ModuleKey[];
  role: WorkspaceRole;
}) {
  const availableActions = buildModuleCreateActions(installedModules, role);
  const canCreateCustomer = can(role, "create:customer");
  const canEnableModule = can(role, "manage:module");

  if (availableActions.length === 0 && !canCreateCustomer && !canEnableModule) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          aria-label="Create new"
          className="gap-2 px-3 max-md:size-11 max-md:px-0 md:max-xl:size-9 md:max-xl:px-0"
        >
          <Plus className="size-4" aria-hidden />
          <span className="max-xl:sr-only">New</span>
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
