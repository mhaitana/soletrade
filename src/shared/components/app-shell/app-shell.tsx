"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  CreditCard,
  FileText,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
  Plus,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/shared/ui/sheet";
import { Logo } from "@/shared/components/logo";
import { ThemeToggle } from "@/shared/components/theme-toggle";
import { NotificationBell } from "@/shared/components/notification-bell/notification-bell";
import { WorkspaceSwitcher, type WorkspaceOption } from "./workspace-switcher";
import { AccountMenu } from "./account-menu";
import { SearchTrigger } from "@/shared/components/command-palette/search-trigger";
import { MODULES, type ModuleKey } from "@/shared/constants/modules";
import type { LucideIcon } from "lucide-react";
import type { WorkspaceId } from "@/shared/types/ids";

export type NavItem = { href: string; label: string; icon: LucideIcon };

export type AppShellProps = {
  workspaces: WorkspaceOption[];
  activeWorkspaceId: WorkspaceId;
  installedModules: ModuleKey[];
  userEmail: string;
  /** Initial unread notification count (server-rendered for first-paint badge). */
  notificationCount: number;
  children: React.ReactNode;
};

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function buildNav(installedModules: ModuleKey[]): NavItem[] {
  const platformNav: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/assistant", label: "Assistant", icon: Bot },
    ...installedModules.map((key) => ({
      href: MODULES[key].href,
      label: MODULES[key].shortName,
      icon: MODULES[key].icon,
    })),
    { href: "/customers", label: "Customers", icon: Users },
    { href: "/files", label: "Files", icon: FileText },
    { href: "/activity", label: "Activity", icon: Activity },
    { href: "/audit", label: "Audit log", icon: ShieldCheck },
    { href: "/billing", label: "Billing", icon: CreditCard },
    { href: "/settings", label: "Settings", icon: Settings },
  ];
  return platformNav;
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Primary">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span>{item.label}</span>
          </Link>
        );
      })}
      {/* Add-module entry: always visible so disabled modules are surfaced, never silently hidden. */}
      <Link
        href="/settings/modules"
        onClick={onNavigate}
        className="mt-1 flex items-center gap-3 rounded-md border border-dashed border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <Plus className="size-4 shrink-0" aria-hidden />
        <span>Add module</span>
      </Link>
    </nav>
  );
}

function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  // Bottom nav: max 5 items (bottom-nav-limit). 4 pinned + "More".
  const pinned = items.filter((i) =>
    ["/dashboard", "/customers", "/activity", "/billing"].includes(i.href),
  );
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {pinned.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="flex min-w-14 flex-1 flex-col items-center gap-1 px-2 py-2 text-[0.65rem] font-medium"
          >
            <Icon
              className={cn("size-5", active ? "text-primary" : "text-muted-foreground")}
              aria-hidden
            />
            <span className={cn(active ? "text-foreground" : "text-muted-foreground")}>
              {item.label}
            </span>
          </Link>
        );
      })}
      <Sheet>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label="More navigation"
            className="flex min-w-14 flex-1 flex-col items-center gap-1 px-2 py-2 text-[0.65rem] font-medium"
          >
            <MoreHorizontal className="size-5 text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground">More</span>
          </button>
        </SheetTrigger>
        <SheetContent side="bottom" className="w-full">
          <SheetHeader>
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6 pt-2">
            <NavList items={items} />
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}

export function AppShell({
  workspaces,
  activeWorkspaceId,
  installedModules,
  userEmail,
  notificationCount,
  children,
}: AppShellProps) {
  const items = buildNav(installedModules);
  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-sidebar md:flex">
        <div className="flex h-16 items-center border-b border-border px-5">
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavList items={items} />
        </div>
      </aside>

      <div className="md:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur md:px-8">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu className="size-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72">
              <SheetHeader>
                <SheetTitle>
                  <Logo href={null} />
                </SheetTitle>
              </SheetHeader>
              <div className="px-3 pb-6 pt-2">
                <NavList items={items} />
              </div>
            </SheetContent>
          </Sheet>

          <WorkspaceSwitcher workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} />

          <SearchTrigger installedModules={installedModules} />

          <div className="ml-auto flex items-center gap-1">
            <NotificationBell initialUnreadCount={notificationCount} />
            <ThemeToggle />
            <AccountMenu userEmail={userEmail} />
          </div>
        </header>

        <main id="main-content" className="px-4 pb-24 pt-6 md:px-8 md:pb-12">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>

      <BottomNav items={items} />
    </div>
  );
}
