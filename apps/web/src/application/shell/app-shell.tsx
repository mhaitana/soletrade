"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { Menu, MoreHorizontal, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { WorkspaceSwitcher, type WorkspaceOption } from "@/application/shell/workspace-switcher";
import { AccountMenu } from "@/application/shell/account-menu";
import { QuickCreateMenu } from "@/application/shell/quick-create-menu";
import { SearchTrigger } from "@/features/search/components/search-trigger";
import { MODULES, type ModuleKey } from "@/config/modules";
import { buildNav, type NavItem } from "@/config/navigation";
import type { WorkspaceRole } from "@/lib/domain/database-enums";
import type { WorkspaceId } from "@/types/ids";
import { brand } from "@/config/brand";
import { HaiPanelFrame } from "@/components/hai-panel-frame";

// The assistant and AI SDK are only needed after the user asks to open hAI.
// Keep the panel mounted after its first use so drafts and streams survive closing.
const HaiAssistantPanel = lazy(() =>
  import("@/features/assistant/components/hai-assistant-panel").then((module) => ({
    default: module.HaiAssistantPanel,
  })),
);

const MODULE_HREFS = new Set(Object.values(MODULES).map((module) => module.href));

export type AppShellProps = {
  workspaces: WorkspaceOption[];
  activeWorkspaceId: WorkspaceId;
  installedModules: ModuleKey[];
  role: WorkspaceRole;
  userEmail: string;
  /** Initial unread notification count (server-rendered for first-paint badge). */
  notificationCount: number;
  children: React.ReactNode;
};

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
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
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 max-md:px-4 max-md:py-3",
              active
                ? "bg-foreground text-background shadow-xs font-semibold"
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
        className="mt-1 flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 max-md:px-4 max-md:py-3"
      >
        <Plus className="size-4 shrink-0" aria-hidden />
        <span>Add module</span>
      </Link>
    </nav>
  );
}

function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  // Prioritise daily work on mobile: Dashboard + up to three installed modules.
  // When a workspace has fewer modules, fill the remaining slots with Customers
  // and Assistant. Administrative destinations stay available under More.
  const preferredHrefs = [
    "/dashboard",
    ...items.filter((item) => MODULE_HREFS.has(item.href)).map((item) => item.href),
    "/customers",
    "/assistant",
  ];
  const pinned = preferredHrefs
    .map((href) => items.find((item) => item.href === href))
    .filter((item): item is NavItem => Boolean(item))
    .filter(
      (item, index, all) => all.findIndex((candidate) => candidate.href === item.href) === index,
    )
    .slice(0, 4);
  const moreActive = items.some(
    (item) => isActive(pathname, item.href) && !pinned.some((pin) => pin.href === item.href),
  );
  return (
    <nav
      aria-label="Mobile primary"
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-border/80 bg-background/90 backdrop-blur-md pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {pinned.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="flex min-w-14 flex-1 flex-col items-center gap-1 px-2 py-2 text-[0.65rem] font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/40"
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
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label={moreActive ? "More navigation (current section)" : "More navigation"}
            className={cn(
              "flex min-w-14 flex-1 cursor-pointer flex-col items-center gap-1 px-2 py-2 text-[0.65rem] font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/40",
              moreActive ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <MoreHorizontal className="size-5" aria-hidden />
            <span>More</span>
          </button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] w-full gap-0 overflow-hidden"
          aria-describedby={undefined}
        >
          <SheetHeader className="shrink-0 border-b border-border pr-16">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
            <NavList items={items} onNavigate={() => setMoreOpen(false)} />
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
  role,
  userEmail,
  notificationCount,
  children,
}: AppShellProps) {
  const items = useMemo(() => buildNav(installedModules, role), [installedModules, role]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [haiOpen, setHaiOpen] = useState(false);
  const [haiStarted, setHaiStarted] = useState(false);
  const haiTriggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="min-h-dvh overflow-x-clip">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-sidebar md:flex">
        <div className="flex h-16 items-center border-b border-border px-5">
          <Logo variant="compact" />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavList items={items} />
        </div>
      </aside>

      <div
        className={cn(
          "transition-[padding] duration-200 motion-reduce:transition-none md:pl-64",
          haiOpen && "2xl:pr-96",
        )}
      >
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-1.5 border-b border-border bg-background/80 px-4 backdrop-blur min-[360px]:gap-3 md:px-8">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu className="size-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="h-dvh w-72 gap-0 overflow-hidden"
              aria-describedby={undefined}
            >
              <SheetHeader className="shrink-0 border-b border-border pr-16">
                <SheetTitle>
                  <Logo href={null} variant="compact" />
                </SheetTitle>
              </SheetHeader>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
                {/* Workspace switcher is desktop-only in the top bar; surface it here so
                    mobile users can still switch workspaces without the desktop chrome. */}
                <WorkspaceSwitcher
                  workspaces={workspaces}
                  activeWorkspaceId={activeWorkspaceId}
                  showOnMobile
                />
                <NavList items={items} onNavigate={() => setMobileOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>

          <WorkspaceSwitcher workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} />

          <QuickCreateMenu installedModules={installedModules} role={role} />

          <SearchTrigger installedModules={installedModules} role={role} />

          <div className="ml-auto flex items-center gap-0 min-[360px]:gap-1">
            <Button
              ref={haiTriggerRef}
              type="button"
              variant={haiOpen ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setHaiStarted(true);
                setHaiOpen((current) => !current);
              }}
              aria-expanded={haiOpen}
              aria-controls="hai-assistant-panel"
              className="min-h-11 min-w-11 gap-1.5 px-2.5 text-brand-blue max-[420px]:size-11 max-[420px]:px-0"
              title={`Open ${brand.assistantName}`}
            >
              <Sparkles className="size-4" aria-hidden />
              <span className="max-[420px]:sr-only">{brand.assistantName}</span>
            </Button>
            <NotificationBell initialUnreadCount={notificationCount} />
            <ThemeToggle />
            <AccountMenu userEmail={userEmail} />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="px-4 pb-24 pt-6 md:px-8 md:pb-12">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>

      <BottomNav items={items} />
      {haiStarted ? (
        <Suspense
          fallback={
            <HaiPanelFrame open={haiOpen} onOpenChange={setHaiOpen} returnFocusRef={haiTriggerRef}>
              <div className="flex items-center justify-between gap-3 p-4">
                <p role="status" className="text-sm text-muted-foreground">
                  Loading {brand.assistantName}…
                </p>
                <Button variant="outline" onClick={() => setHaiOpen(false)}>
                  Close
                </Button>
              </div>
            </HaiPanelFrame>
          }
        >
          <HaiAssistantPanel
            key={activeWorkspaceId}
            open={haiOpen}
            onOpenChange={setHaiOpen}
            returnFocusRef={haiTriggerRef}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
