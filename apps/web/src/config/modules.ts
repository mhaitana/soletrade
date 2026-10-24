import { BookOpen, Car, FileText, Receipt, type LucideIcon } from "lucide-react";

/**
 * Module catalog. Modules are independently enabled per workspace via
 * `module_installations`. The platform nav only shows installed modules.
 */
export const MODULE_KEYS = ["invoices", "books", "drive", "quotes"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModuleMeta = {
  key: ModuleKey;
  /** Concise in-app module label ("Invoices"). The full `Soletrade - Invoices` form is used only for Stripe product display names. */
  name: string;
  shortName: string; // "Invoices"
  description: string;
  href: string; // app route
  icon: LucideIcon;
};

export const MODULES: Record<ModuleKey, ModuleMeta> = {
  invoices: {
    key: "invoices",
    name: "Invoices",
    shortName: "Invoices",
    description: "Bill clients and accept card payments.",
    href: "/invoices",
    icon: Receipt,
  },
  books: {
    key: "books",
    name: "Books",
    shortName: "Books",
    description: "Track income, expenses, and receipts.",
    href: "/books",
    icon: BookOpen,
  },
  drive: {
    key: "drive",
    name: "Drive",
    shortName: "Drive",
    description: "Log gig earnings and mileage.",
    href: "/drive",
    icon: Car,
  },
  quotes: {
    key: "quotes",
    name: "Quotes",
    shortName: "Quotes",
    description: "Send proposals and convert to invoices.",
    href: "/quotes",
    icon: FileText,
  },
};

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}
