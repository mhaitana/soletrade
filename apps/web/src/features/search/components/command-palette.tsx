"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { defaultFilter } from "cmdk";
import { Sparkles } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  buildCreateActions,
  buildNav,
  buildSecondaryNav,
  type CreateAction,
  type NavItem,
} from "@/config/navigation";
import { SEARCH_MODULE_LABEL, type SearchResultGroup } from "@/types/search";
import { cn } from "@/lib/utils";
import { brand } from "@/config/brand";
import { askHai } from "@/lib/assistant/launcher";
import { Button } from "@/components/ui/button";
import type { ModuleKey } from "@/config/modules";
import type { WorkspaceRole } from "@/lib/domain/database-enums";

/**
 * ⌘K command palette (Wave 3). A `CommandDialog` (cmdk wrapped in the vendored `Dialog`) with
 * three kinds of entries: a **Navigate** group built from the same `buildNav` the sidebar uses
 * (so the palette and nav never drift) plus, once the user types, the sub-pages that have no
 * sidebar entry (Receipts, GST / BAS, Vehicles, settings sections); a **Create** group built
 * from the same list as the header "New" menu; and **live search** groups fetched from
 * `/api/search` with a 150ms debounce. Selecting any item navigates + closes the palette.
 * Whatever was typed can also be put to hAI as a question (the last entry).
 *
 * Navigation is filtered locally; server results are already matched against fields such as
 * customer company and notes that may not appear in the displayed label. Each response belongs
 * to one query attempt so typing or retrying cannot display results from an earlier request.
 */
export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installedModules: ModuleKey[];
  role: WorkspaceRole;
}

type SearchResponse =
  | { version: number; status: "success"; groups: SearchResultGroup[] }
  | { version: number; status: "error" };

export function CommandPalette({
  open,
  onOpenChange,
  installedModules,
  role,
}: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [requestVersion, setRequestVersion] = useState(0);
  const [response, setResponse] = useState<SearchResponse | null>(null);

  const navItems = useMemo<NavItem[]>(
    () => buildNav(installedModules, role),
    [installedModules, role],
  );
  const secondaryNavItems = useMemo<NavItem[]>(
    () => buildSecondaryNav(installedModules, role),
    [installedModules, role],
  );
  const createActions = useMemo<CreateAction[]>(
    () => buildCreateActions(installedModules, role),
    [installedModules, role],
  );

  const term = query.trim();
  const showResults = open && term.length >= 2;
  const currentResponse = response?.version === requestVersion ? response : null;
  const loading = showResults && currentResponse === null;
  const failed = showResults && currentResponse?.status === "error";
  const visibleGroups =
    showResults && currentResponse?.status === "success" ? currentResponse.groups : [];
  // With no query the palette shows the main navigation only, to stay short; sub-pages
  // appear as soon as the query matches them.
  const visibleNavItems = term
    ? [...navItems, ...secondaryNavItems].filter((item) => defaultFilter(item.label, term) > 0)
    : navItems;
  // Match on the label only: the filter is a fuzzy subsequence match, and including the
  // description made unrelated record searches surface create actions above the results.
  const visibleCreateActions = createActions.filter(
    (action) => !term || defaultFilter(action.label, term) > 0,
  );

  // Include the debounce in the loading state, and guard completion as well as fetch itself:
  // an obsolete request may already be decoding its response when it is aborted.
  useEffect(() => {
    if (!showResults) return;
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const result = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (!result.ok) throw new Error("Search request failed");
        const data = (await result.json()) as { groups?: SearchResultGroup[] };
        if (!controller.signal.aborted) {
          setResponse({ version: requestVersion, status: "success", groups: data.groups ?? [] });
        }
      } catch {
        if (!controller.signal.aborted) {
          setResponse({ version: requestVersion, status: "error" });
        }
      }
    }, 150);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [term, requestVersion, showResults]);

  // Reset query + results when the palette closes. Uses the adjust-state-during-render pattern
  // (react-hooks/set-state-in-effect flags setState in an effect body); tracking the previous
  // `open` value lets us reset synchronously during render on the open→closed transition, and
  // reopening starts fresh.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setQuery("");
      setResponse(null);
    }
  }

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  const hasResults = visibleGroups.some((g) => g.results.length > 0);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search workspace"
      description="Find records, go to a page, or start something new."
      shouldFilter={false}
      className="sm:max-w-xl"
    >
      <CommandInput
        value={query}
        onValueChange={(value) => {
          setQuery(value);
          setRequestVersion((version) => version + 1);
        }}
        placeholder="Search records, go to a page, or create something…"
      />
      {loading ? (
        <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
          Searching…
        </p>
      ) : null}
      {failed ? (
        <div role="alert" className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <p className="text-destructive">Couldn&apos;t search your workspace. Please try again.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onKeyDown={(event) => event.stopPropagation()}
            onClick={() => setRequestVersion((version) => version + 1)}
          >
            Try again
          </Button>
        </div>
      ) : null}
      <CommandList aria-busy={loading}>
        {!loading && !failed ? (
          <CommandEmpty>
            {showResults ? "No results." : "Type at least 2 characters to search records."}
          </CommandEmpty>
        ) : null}

        {visibleNavItems.length > 0 ? (
          <CommandGroup heading="Navigate">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem key={item.href} value={item.href} onSelect={() => go(item.href)}>
                  <Icon className="size-4 shrink-0 opacity-60" aria-hidden />
                  <span>{item.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {visibleCreateActions.length > 0 ? (
          <CommandGroup heading="Create">
            {visibleCreateActions.map((action) => {
              const Icon = action.icon;
              return (
                <CommandItem
                  key={action.key}
                  value={`create-${action.key}`}
                  onSelect={() => go(action.href)}
                >
                  <Icon className="size-4 shrink-0 opacity-60" aria-hidden />
                  <span>{action.label}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {action.description}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {hasResults
          ? visibleGroups.map((group) =>
              group.results.length === 0 ? null : (
                <CommandGroup key={group.module} heading={SEARCH_MODULE_LABEL[group.module]}>
                  {group.results.map((r) => (
                    <CommandItem
                      key={`${r.module}-${r.id}`}
                      value={`${r.module}-${r.id}`}
                      onSelect={() => go(r.href)}
                    >
                      <span className="truncate font-medium">{r.label}</span>
                      {r.sublabel ? (
                        <span className={cn("ml-auto truncate text-xs text-muted-foreground")}>
                          {r.sublabel}
                        </span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ),
            )
          : null}

        {/* Last, and only once the search has answered, so Enter still opens the first page
            or record that matched instead of this entry. */}
        {term && !loading ? (
          <CommandGroup heading={brand.assistantName}>
            <CommandItem
              value="ask-assistant"
              onSelect={() => {
                onOpenChange(false);
                askHai({ question: term, send: true });
              }}
            >
              <Sparkles className="size-4 shrink-0 text-brand-blue" aria-hidden />
              <span className="truncate">
                Ask {brand.assistantName}: &ldquo;{term}&rdquo;
              </span>
            </CommandItem>
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
