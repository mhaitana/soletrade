/**
 * Search result types shared across the app-layer search composition root
 * (`src/app/api/search/search.ts`) and the shared-layer command palette
 * (`src/shared/components/command-palette/command-palette.tsx`).
 *
 * Lives in `shared/types` so the shared palette component can import the result shape +
 * module label map WITHOUT crossing the shared→app boundary (shared must not import
 * app/module/platform). The composition root in the app layer imports these same types
 * and produces the values; the palette only consumes them.
 */

export type SearchModule = "customers" | "invoices" | "quotes" | "books" | "drive" | "files";

/** A single tagged search hit, serializable for the /api/search JSON response. */
export interface SearchResult {
  module: SearchModule;
  id: string;
  label: string;
  sublabel?: string;
  href: string;
}

export interface SearchResultGroup {
  module: SearchModule;
  results: SearchResult[];
}

/** Display label for each search group (used as the cmdk `CommandGroup` heading). */
export const SEARCH_MODULE_LABEL: Record<SearchModule, string> = {
  customers: "Customers",
  invoices: "Invoices",
  quotes: "Quotes",
  books: "Books",
  drive: "Drive",
  files: "Files",
};

/** Canonical group order — customers first (most-likely intent), then modules in nav order. */
export const SEARCH_GROUP_ORDER: SearchModule[] = [
  "customers",
  "invoices",
  "quotes",
  "books",
  "drive",
  "files",
];
