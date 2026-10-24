import type { Binding } from "@/lib/offline/policy";
import type { MobileModule } from "@soletrade/contracts";
export const SHORTCUT_TARGETS = [
  {
    id: "soletrade.exampleift",
    title: "Start shift",
    href: "/feature/shift",
    module: "drive",
    icon: "location",
  },
  {
    id: "soletrade.receipt",
    title: "Capture receipt",
    href: "/feature/receipt",
    module: "books",
    icon: "capturePhoto",
  },
  {
    id: "soletrade.invoice",
    title: "New invoice",
    href: "/edit/invoices/new",
    module: "invoices",
    icon: "compose",
  },
] as const;
export function shortcutTarget(
  action: { id: string; params?: Record<string, unknown> | null },
  binding: Binding,
  modules: MobileModule[],
) {
  if (
    action.params?.userId !== binding.userId ||
    action.params?.workspaceId !== binding.workspaceId
  )
    return null;
  const item = SHORTCUT_TARGETS.find((target) => target.id === action.id);
  return item && modules.includes(item.module) ? item.href : null;
}
