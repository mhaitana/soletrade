import {
  Activity,
  Bot,
  CreditCard,
  FileText,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { MODULES, type ModuleKey } from "@/config/modules";
import { brand } from "@/config/brand";
import { can } from "@/lib/domain/permissions";
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
