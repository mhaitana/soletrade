"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/lib/utils";

const sections = [
  { href: "/settings/account", label: "Account" },
  { href: "/settings", label: "General" },
  { href: "/settings/modules", label: "Modules" },
  { href: "/settings/members", label: "Members" },
  { href: "/billing", label: "Billing" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-8 md:flex-row">
      <aside className="md:w-52">
        <nav aria-label="Settings" className="flex gap-1 overflow-x-auto md:flex-col">
          {sections.map((s) => {
            const active =
              s.href === "/settings" ? pathname === "/settings" : pathname.startsWith(s.href);
            return (
              <Link
                key={s.href}
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
