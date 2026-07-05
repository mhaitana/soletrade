import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/shared/lib/env";

/**
 * Supabase SSR server client bound to the incoming request's cookies. Use from
 * Server Components, Route Handlers, Server Actions, and `proxy.ts`. Throws a
 * clear error at the boundary if Supabase isn't configured (so marketing routes
 * keep booting without secrets while auth routes fail loudly).
 */
export function createSupabaseServerClient() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }
  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: async () => {
        const store = await cookies();
        return store.getAll();
      },
      setAll: async (toSet) => {
        const store = await cookies();
        for (const { name, value, options } of toSet) {
          store.set(name, value, options);
        }
      },
    },
  });
}

/**
 * Minimal database shape for Supabase type inference. Expand as tables are
 * introduced; this keeps `createServerClient<Database>` typed without needing
 * the generated Supabase types file yet.
 */
export interface Database {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
