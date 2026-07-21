"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { CommandPalette } from "./command-palette";
import type { ModuleKey } from "@/shared/constants/modules";

/**
 * The header search trigger (Wave 3). A button styled like a search box (search icon +
 * "Search…" placeholder + a ⌘K kbd badge) that opens the `CommandPalette`, plus a global
 * `keydown` listener that toggles the palette on ⌘K / Ctrl+K. Owns the `open` state so the
 * AppShell stays a server component - only this small client island needs interactivity.
 *
 * The trigger is always visible (icon-only on small screens, full label + kbd on `sm+`) so
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
          "w-9 px-0 max-md:min-w-11 sm:w-56 sm:justify-start sm:px-3",
        )}
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="ml-auto hidden font-sans text-xs font-medium sm:inline">⌘K</kbd>
      </Button>
      <CommandPalette open={open} onOpenChange={setOpen} installedModules={installedModules} />
    </>
  );
}
