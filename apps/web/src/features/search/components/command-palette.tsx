"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { defaultFilter } from "cmdk";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { buildNav, type NavItem } from "@/config/navigation";
import { SEARCH_MODULE_LABEL, type SearchResultGroup } from "@/types/search";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ModuleKey } from "@/config/modules";

/**
 * ⌘K command palette (Wave 3). A `CommandDialog` (cmdk wrapped in the vendored `Dialog`) with
 * two sections: a static **Navigate** group built from the same `buildNav` the sidebar uses
 * (so the palette and nav never drift), and **live search** groups fetched from `/api/search`
 * with a 150ms debounce as the user types. Selecting any item navigates + closes the palette.
 *
 * Navigation is filtered locally; server results are already matched against fields such as
 * customer company and notes that may not appear in the displayed label. Each response belongs
 * to one query attempt so typing or retrying cannot display results from an earlier request.
 */
export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installedModules: ModuleKey[];
}

type SearchResponse =
  | { version: number; status: "success"; groups: SearchResultGroup[] }
  | { version: number; status: "error" };

export function CommandPalette({ open, onOpenChange, installedModules }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [requestVersion, setRequestVersion] = useState(0);
  const [response, setResponse] = useState<SearchResponse | null>(null);

  const navItems = useMemo<NavItem[]>(() => buildNav(installedModules), [installedModules]);

  const term = query.trim();
  const showResults = open && term.length >= 2;
  const currentResponse = response?.version === requestVersion ? response : null;
  const loading = showResults && currentResponse === null;
  const failed = showResults && currentResponse?.status === "error";
  const visibleGroups =
    showResults && currentResponse?.status === "success" ? currentResponse.groups : [];
  const visibleNavItems = navItems.filter((item) => !term || defaultFilter(item.label, term) > 0);

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
      description="Find records or navigate to a page."
      shouldFilter={false}
      className="sm:max-w-xl"
    >
      <CommandInput
        value={query}
        onValueChange={(value) => {
          setQuery(value);
          setRequestVersion((version) => version + 1);
        }}
        placeholder="Search customers, invoices, quotes, files…"
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
                <CommandItem key={item.href} value={item.label} onSelect={() => go(item.href)}>
                  <Icon className="size-4 shrink-0 opacity-60" aria-hidden />
                  <span>{item.label}</span>
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
      </CommandList>
    </CommandDialog>
  );
}
