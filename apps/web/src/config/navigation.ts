import {
  Activity,
  Bell,
  BookOpen,
  Bot,
  Car,
  CreditCard,
  FilePlus2,
  FileText,
  Fuel,
  LayoutDashboard,
  Landmark,
  Puzzle,
  Receipt,
  ScanLine,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { MODULES, type ModuleKey } from "@/config/modules";
import { brand } from "@/config/brand";
import { can, type Permission } from "@/lib/domain/permissions";
import type { WorkspaceRole } from "@/lib/domain/database-enums";

export type NavItem = { href: string; label: string; icon: LucideIcon };

export function buildNav(installedModules: ModuleKey[], role: WorkspaceRole): NavItem[] {
  const platformNav: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/assistant", label: brand.assistantName, icon: Bot },
    ...installedModules.map((key) => ({
      href: MODULES[key].href,
      label: MODULES[key].shortName,
      icon: MODULES[key].icon,
    })),
    { href: "/customers", label: "Customers", icon: Users },
    { href: "/files", label: "Files", icon: FileText },
    { href: "/activity", label: "Activity", icon: Activity },
    ...(can(role, "view:audit") ? [{ href: "/audit", label: "Audit log", icon: ShieldCheck }] : []),
    { href: "/billing", label: "Billing", icon: CreditCard },
    { href: "/settings", label: "Settings", icon: Settings },
  ];
  return platformNav;
}

/**
 * Pages one level below the main navigation (module sub-pages and settings sections). They
 * are not in the sidebar, so the command palette lists them: without this, pages such as
 * GST / BAS had no way in except a typed URL. Gated by installed module and role, like the
 * main navigation.
 */
export function buildSecondaryNav(installedModules: ModuleKey[], role: WorkspaceRole): NavItem[] {
  const has = (key: ModuleKey) => installedModules.includes(key);
  const items: NavItem[] = [];
  if (has("books") && can(role, "view:books")) {
    items.push(
      { href: "/books/receipts", label: "Receipts", icon: ScanLine },
      { href: "/books/tax", label: "GST / BAS", icon: Landmark },
    );
  }
  if (has("drive") && can(role, "view:drive")) {
    items.push(
      { href: "/drive/vehicles", label: "Vehicles", icon: Car },
      { href: "/drive/expenses", label: "Vehicle expenses", icon: Fuel },
      { href: "/drive/settings", label: "Drive settings", icon: SlidersHorizontal },
    );
  }
  items.push(
    { href: "/notifications", label: "Notifications", icon: Bell },
    { href: "/settings/account", label: "Account settings", icon: UserCog },
    { href: "/settings/members", label: "Members", icon: Users },
  );
  if (can(role, "manage:module")) {
    items.push({ href: "/settings/modules", label: "Modules", icon: Puzzle });
  }
  return items;
}

export type CreateAction = {
  key: string;
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

const MODULE_CREATE_ACTIONS: Record<
  ModuleKey,
  Omit<CreateAction, "key"> & { permission: Permission }
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

/** Per-module "New …" actions the role may use, in installed-module order. */
export function buildModuleCreateActions(
  installedModules: ModuleKey[],
  role: WorkspaceRole,
): CreateAction[] {
  return installedModules
    .map((key) => ({ key, ...MODULE_CREATE_ACTIONS[key] }))
    .filter((action) => can(role, action.permission))
    .map(({ key, href, label, description, icon }) => ({ key, href, label, description, icon }));
}

/**
 * Every "New …" action the role may use: the module actions plus New customer. One list
 * feeds both the header "New" menu and the command palette so the two cannot drift.
 */
export function buildCreateActions(
  installedModules: ModuleKey[],
  role: WorkspaceRole,
): CreateAction[] {
  const actions = buildModuleCreateActions(installedModules, role);
  if (can(role, "create:customer")) {
    actions.push({
      key: "customer",
      href: "/customers/new",
      label: "New customer",
      description: "Add someone you bill or quote",
      icon: UserPlus,
    });
  }
  return actions;
}
