/**
 * Books category catalog (Phase 6). Pure data + lookup helpers — no `server-only`, no
 * app/module/platform imports, so both the client form and the server action/service can
 * import it without dragging server-only into the client bundle. Mirrors the
 * `src/shared/constants/modules` pattern: data only (the validation logic lives in the
 * action/service, satisfying "no business logic in `src/shared/*`").
 *
 * Categories are slugs (`key`) + human labels. Stored on `book_transactions.category` as
 * `text` (not a DB enum) so this seed list can grow without a migration. `type` ("income"
 * | "expense") is taken from the `book_type` pgEnum; the helpers accept the literal union
 * directly to avoid a shared→server import.
 */

export interface BookCategory {
  /** Stable slug stored on the row. */
  key: string;
  /** Human label shown in the UI. */
  label: string;
}

export const INCOME_CATEGORIES = [
  { key: "sales", label: "Sales" },
  { key: "services", label: "Services" },
  { key: "software", label: "Software" },
  { key: "hardware", label: "Hardware" },
  { key: "invoice", label: "Invoice" },
  { key: "gig", label: "Gig earnings" },
  { key: "other_income", label: "Other income" },
] as const satisfies readonly BookCategory[];

export const EXPENSE_CATEGORIES = [
  { key: "rent", label: "Rent" },
  { key: "utilities", label: "Utilities" },
  { key: "supplies", label: "Supplies" },
  { key: "travel", label: "Travel" },
  { key: "wages", label: "Wages" },
  { key: "software_expense", label: "Software" },
  { key: "other_expense", label: "Other expense" },
] as const satisfies readonly BookCategory[];

/** Categories available for a given transaction `type`. */
export function categoriesForType(type: "income" | "expense"): readonly BookCategory[] {
  return type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

/** True if `key` is a valid category slug for the given transaction `type`. */
export function isBookCategory(type: "income" | "expense", key: string): boolean {
  return categoriesForType(type).some((c) => c.key === key);
}

/** Human label for a stored slug, or `null` if it isn't in the catalog for that `type`. */
export function categoryLabel(type: "income" | "expense", key: string): string | null {
  return categoriesForType(type).find((c) => c.key === key)?.label ?? null;
}
