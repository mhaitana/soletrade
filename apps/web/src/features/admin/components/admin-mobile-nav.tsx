"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NAV_GROUPS, isAdminItemActive } from "@/features/admin/components/admin-nav";
import { AdminSignOutButton } from "@/features/admin/components/admin-sign-out-button";

/**
 * Mobile nav drawer for the admin area. Visible below `lg`. Mirrors the
 * desktop sidebar's grouped nav. Closes on navigation.
 */
export function AdminMobileNav({ signOutAction }: { signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Open admin navigation"
          className="lg:hidden"
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <span className="rounded-lg border border-brand-blue/30 bg-brand-blue/10 p-1.5 text-brand-blue">
              <ShieldAlert className="size-4" />
            </span>
            Soletrade Operations
          </SheetTitle>
        </SheetHeader>
        <nav className="flex-1 overflow-y-auto p-3" aria-label="Admin navigation">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="mb-4">
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = isAdminItemActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={isActive ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-brand-blue/10 text-brand-blue border border-brand-blue/30"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground border border-transparent"
                      }`}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-border p-4">
          <AdminSignOutButton
            signOutAction={signOutAction}
            className="w-full justify-center gap-2"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
