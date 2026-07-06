"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/ui/command";
import { buildNav, type NavItem } from "@/shared/components/app-shell/app-shell";
import { SEARCH_MODULE_LABEL, type SearchResultGroup } from "@/shared/types/search";
import { cn } from "@/shared/lib/utils";
import type { ModuleKey } from "@/shared/constants/modules";

/**
 * ⌘K command palette (Wave 3). A `CommandDialog` (cmdk wrapped in the vendored `Dialog`) with
 * two sections: a static **Navigate** group built from the same `buildNav` the sidebar uses
 * (so the palette and nav never drift), and **live search** groups fetched from `/api/search`
 * with a 150ms debounce as the user types. Selecting any item navigates + closes the palette.
 *
 * cmdk filters all items client-side against the input; nav items that don't match the typed
 * query simply disappear, leaving the live search results. Search results carry `label +
 * sublabel` as their cmdk `value` so the same substring the server matched (name/number/
 * description/email) is what cmdk matches on — keeping client + server filtering consistent.
 */
export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installedModules: ModuleKey[];
}

export function CommandPalette({ open, onOpenChange, installedModules }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchResultGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const navItems = useMemo<NavItem[]>(() => buildNav(installedModules), [installedModules]);

  const term = query.trim();
  // Stale results from a previous query are hidden during render when the term drops below the
  // 2-char server guard, so the search effect never needs to setState for the short-query case
  // (that would trip react-hooks/set-state-in-effect and cause cascading renders).
  const showResults = term.length >= 2;

  // Debounced live search. The effect owns ONLY the fetch side-effect (debounce timer + abort
  // controller); `setLoading` lives inside the debounced callback, not the effect body, so there
  // is no loading flash to clear on each keystroke. Below 2 chars the server guard returns []
  // anyway, so we skip the fetch entirely.
  useEffect(() => {
    if (!open || !showResults) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const handle = setTimeout(() => {
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { groups: [] }))
        .then((data: { groups?: SearchResultGroup[] }) => setGroups(data.groups ?? []))
        .catch(() => {
          // Abort on new keystroke is expected — swallow. Real errors leave the last good list.
        })
        .finally(() => setLoading(false));
    }, 150);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [term, open, showResults]);

  // Abort any in-flight request when the palette closes (pure side-effect — no setState).
  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);

  // Reset query + results when the palette closes. Uses the adjust-state-during-render pattern
  // (react-hooks/set-state-in-effect flags setState in an effect body); tracking the previous
  // `open` value lets us reset synchronously during render on the open→closed transition, and
  // reopening starts fresh.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setQuery("");
      setGroups([]);
      setLoading(false);
    }
  }

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  const visibleGroups = showResults ? groups : [];
  const hasResults = visibleGroups.some((g) => g.results.length > 0);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} className="sm:max-w-xl">
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search customers, invoices, quotes, files…"
      />
      <CommandList>
        <CommandEmpty>{loading ? "Searching…" : "No results."}</CommandEmpty>

        <CommandGroup heading="Navigate">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem key={item.href} value={item.label} onSelect={() => go(item.href)}>
                <Icon className="size-4 shrink-0 opacity-60" aria-hidden />
                <span>{item.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        {hasResults
          ? visibleGroups.map((group) =>
              group.results.length === 0 ? null : (
                <CommandGroup key={group.module} heading={SEARCH_MODULE_LABEL[group.module]}>
                  {group.results.map((r) => (
                    <CommandItem
                      key={`${r.module}-${r.id}`}
                      value={`${r.label} ${r.sublabel ?? ""}`}
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
