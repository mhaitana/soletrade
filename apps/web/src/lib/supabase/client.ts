"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/domain/database/supabase";

/**
 * Supabase browser client. `NEXT_PUBLIC_*` values are inlined by Next at build
 * time, so this is safe to import from Client Components (no `server-only`).
 * Throws at call time if Supabase env isn't configured.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase browser env is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return createBrowserClient<Database>(url, anonKey);
}
