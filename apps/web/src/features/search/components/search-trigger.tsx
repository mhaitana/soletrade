"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ModuleKey } from "@/config/modules";

// cmdk + its dialog primitives are not needed for first paint. Keep them out of
// every authenticated page's initial client bundle and load them only after the
// user opens search.
const CommandPalette = dynamic(
  () =>
    import("@/features/search/components/command-palette").then((module) => module.CommandPalette),
  { ssr: false },
);

/**
 * The header search trigger (Wave 3). A button styled like a search box (search icon +
 * "Search…" placeholder + a ⌘K kbd badge on wide screens) that opens the `CommandPalette`, plus a global
 * `keydown` listener that toggles the palette on ⌘K / Ctrl+K. Owns the `open` state so the
 * AppShell stays a server component - only this small client island needs interactivity.
 *
 * The trigger is always visible (icon-only below `xl`, full label + kbd on wide screens) so
 * mobile users can still tap to open the palette; the ⌘K shortcut is desktop-only by nature.
 */
export interface SearchTriggerProps {
  installedModules: ModuleKey[];
}

export function SearchTrigger({ installedModules }: SearchTriggerProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label="Search (⌘K)"
        className={cn(
          "text-muted-foreground",
          "w-9 px-0 max-md:min-w-11 xl:w-56 xl:justify-start xl:px-3",
        )}
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="hidden xl:inline">Search…</span>
        <kbd className="ml-auto hidden font-sans text-xs font-medium xl:inline">⌘K</kbd>
      </Button>
      {open ? (
        <CommandPalette open={open} onOpenChange={setOpen} installedModules={installedModules} />
      ) : null}
    </>
  );
}
