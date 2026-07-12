"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

/**
 * Client-side GET search for admin list pages. Navigates to `?search=<q>`,
 * keeping the URL shareable and matching the Next 16 searchParams Promise
 * pattern. Not a Server Action — search is a read, not a mutation.
 */
export function AdminSearchForm({ placeholder = "Search…" }: { placeholder?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const current = params.get("search") ?? "";
  const [value, setValue] = React.useState(current);

  // Keep the input in sync if the URL changes (e.g. clear button, browser back).
  // Adjusted during render instead of in an effect to satisfy
  // react-hooks/set-state-in-effect.
  const [lastCurrent, setLastCurrent] = React.useState(current);
  if (current !== lastCurrent) {
    setLastCurrent(current);
    setValue(current);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    const target = q ? `?search=${encodeURIComponent(q)}` : "?";
    router.push(target);
  }

  function clear() {
    setValue("");
    router.push("?");
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2" role="search">
      <div className="relative w-full max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="pl-8 pr-8"
        />
        {current ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      <Button type="submit" variant="outline" size="sm">
        Search
      </Button>
    </form>
  );
}
