import {
  LayoutDashboard,
  Users,
  Building2,
  CreditCard,
  Tag,
  Coins,
  LifeBuoy,
  KeyRound,
  FileText,
  Flag,
  Webhook,
  Workflow,
  ServerCrash,
  type LucideIcon,
} from "lucide-react";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface AdminNavGroup {
  title: string;
  items: AdminNavItem[];
}

/**
 * Shared admin navigation config. Consumed by the desktop sidebar (AdminShell)
 * and the mobile Sheet drawer (AdminMobileNav). Dashboard is an exact match;
 * every other item matches by prefix so detail routes highlight their parent.
 */
export const NAV_GROUPS: AdminNavGroup[] = [
  {
    title: "Overview",
    items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    title: "People",
    items: [
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/workspaces", label: "Workspaces", icon: Building2 },
    ],
  },
  {
    title: "Billing",
    items: [
      { href: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
      { href: "/admin/promotions", label: "Promotions", icon: Tag },
      { href: "/admin/credits", label: "Credit Ledger", icon: Coins },
    ],
  },
  {
    title: "Support",
    items: [
      { href: "/admin/support", label: "Support Tickets", icon: LifeBuoy },
      { href: "/admin/access-requests", label: "Support Access", icon: KeyRound },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/admin/audit", label: "Audit Log", icon: FileText },
      { href: "/admin/feature-flags", label: "Feature Flags", icon: Flag },
      { href: "/admin/webhooks", label: "Webhooks", icon: Webhook },
      { href: "/admin/jobs", label: "Background Jobs", icon: Workflow },
      { href: "/admin/system", label: "System Health", icon: ServerCrash },
    ],
  },
];

export function isAdminItemActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}
