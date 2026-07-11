import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/server/db/types";

/**
 * Query helpers for the Supabase data client (migration off Drizzle). Server infra
 * only — no business logic (the `shared` boundary ban doesn't apply; this is `server/`).
 *
 * PostgREST returns every call as `{ data, error }`. The unwrap helpers below take the
 * un-awaited query builder (a thenable), `await` it themselves, and throw on `error` so
 * callers get the typed `data` back directly — the closest thing to Drizzle's throw-on-error
 * `db.select(...)` ergonomics. Awaiting inside the helper (rather than `unwrap(await ...)`)
 * is required: passing `await <query>` inline makes TypeScript infer the row type as `never`
 * (a quirk with supabase-js' conditional select-string types); the thenable generic
 * `R extends Envelope` resolves it correctly.
 */

/** Public-schema PL/pgSQL RPC functions (the 7 atomic writers from migration 0001). */
type PublicFunctions = Database["public"]["Functions"];
type RpcName = keyof PublicFunctions;

/**
 * Generated Supabase `Args` types lose nullability: a nullable `text`/`timestamptz`
 * parameter is typed bare `string`, not `string | null`. This widens every string param
 * to `string | null` so callers can pass `null` for nullable columns (e.g. `due_date`,
 * `customer_id`, `notes`). It preserves the `?` optionality modifier, so required keys
 * must still be present and typos are still caught (fresh object literals are contextually
 * typed against this shape). Dates are passed as ISO strings — the generated type already
 * says `string` for `timestamptz` params, and the SQL function casts the string to
 * `timestamptz` / via `jsonb_populate_record`.
 *
 * `jsonb` params (`p_set`, `p_line_items`, `p_sections`, `p_metadata`) are typed `Json` by
 * the generator, but callers naturally hold them as `Record<string, unknown>` or typed
 * arrays. `[Json] extends [T]` is true ONLY when `T` is the full `Json` union (not for a
 * primitive like `number`), so we widen exactly those args to also accept plain records
 * and arrays without relaxing `number`/`boolean` args.
 */
type LooseArg<T> = [T] extends [string | undefined]
  ? string | null
  : [Json] extends [T]
    ? T | Record<string, unknown> | unknown[]
    : T;

type LooseArgs<F extends RpcName> = {
  [K in keyof PublicFunctions[F]["Args"]]: LooseArg<PublicFunctions[F]["Args"][K]>;
};

/**
 * Call a PL/pgSQL RPC function and return its `{ data, error }` envelope (unlike
 * `unwrap`, this does NOT throw on error — callers of the atomic writers need to
 * inspect `error.code`, e.g. `23505` for a unique-number race to drive the retry loop,
 * or `45003` for the credit-overdraft guard). The `error` shape is narrowed to the two
 * fields callers read (`code`, `message`).
 */
export async function rpc<F extends RpcName>(
  client: SupabaseClient<Database>,
  fn: F,
  args: LooseArgs<F>,
): Promise<{
  data: PublicFunctions[F]["Returns"] | null;
  error: { code: string; message: string } | null;
}> {
  const result = await client.rpc(fn, args as never);
  return result as {
    data: PublicFunctions[F]["Returns"] | null;
    error: { code: string; message: string } | null;
  };
}

/** A PostgREST response envelope (the shape a thenable query builder resolves to). */
type Envelope<T = unknown> = { data: T | null; error: { code: string; message: string } | null };

/**
 * Unwrap a multi-row PostgREST response: throw on error, return `data` as a non-null
 * typed array. Use for `.select()` lists (`.eq(...)` etc.) and `.insert(...).select()` /
 * `.update(...).select()` that return rows. `NonNullable<R["data"]>` strips the `| null`
 * so callers get `Row[]`.
 */
export async function unwrap<R extends Envelope>(
  query: PromiseLike<R>,
): Promise<NonNullable<R["data"]>> {
  const r = await query;
  if (r.error) {
    throw new Error(`PostgREST error [${r.error.code}]: ${r.error.message}`);
  }
  return (r.data ?? null) as NonNullable<R["data"]>;
}

/**
 * Unwrap a single-row PostgREST response: throw on error, return the row or `null`
 * (preserving the `| null` of `R["data"]`). Use with `.maybeSingle()` (zero-or-one) —
 * for exactly-one `.single()`, prefer `unwrapOne`.
 */
export async function unwrapMaybe<R extends Envelope>(query: PromiseLike<R>): Promise<R["data"]> {
  const r = await query;
  if (r.error) {
    throw new Error(`PostgREST error [${r.error.code}]: ${r.error.message}`);
  }
  return (r.data ?? null) as R["data"];
}

/**
 * Unwrap a single-row PostgREST response expected to exist: throw on error OR on a
 * missing row. Use with `.single()` (exactly-one) for "get by id" reads that should
 * 404 when absent rather than silently return null.
 */
export async function unwrapOne<R extends Envelope>(
  query: PromiseLike<R>,
  notFoundMessage = "Row not found",
): Promise<NonNullable<R["data"]>> {
  const r = await query;
  if (r.error) {
    throw new Error(`PostgREST error [${r.error.code}]: ${r.error.message}`);
  }
  if (r.data === null) {
    throw new Error(notFoundMessage);
  }
  return r.data as NonNullable<R["data"]>;
}

/**
 * Throw on error for a mutation that doesn't return rows (no `.select()` chained).
 * Use for `.insert()` / `.update()` / `.delete()` / `.upsert()` writes whose only
 * signal is success-vs-error — `data` is discarded.
 */
export async function unwrapVoid<R extends Envelope>(query: PromiseLike<R>): Promise<void> {
  const r = await query;
  if (r.error) {
    throw new Error(`PostgREST error [${r.error.code}]: ${r.error.message}`);
  }
}

/**
 * Parse a PostgREST `timestamp without time zone` string into a Date interpreted as
 * **UTC** — matching what node-postgres (Drizzle) returned for the same column. EVERY
 * timestamp column in our schema is `timestamp without time zone` (none use
 * `withTimezone: true`), and PostgREST serializes that type as a bare ISO string with
 * NO trailing offset (e.g. `"2026-03-01T00:00:00"`). `new Date(bareIso)` interprets a
 * no-offset string as LOCAL time, so on a non-UTC host it shifts the instant by the tz
 * offset — e.g. on Australia (+11) `2026-03-01T00:00:00` becomes `2026-02-28T13:00:00Z`,
 * which flips a 1-March date into February and breaks `getUTCMonth()`-based period
 * bucketing in `calc.ts`/`periods.ts`. node-postgres parses oid 1114 as UTC
 * (`new Date(Date.UTC(...))`), so appending `Z` reproduces Drizzle's Date exactly.
 *
 * Defensive: if a value already carries an offset or `Z` (a true `timestamptz`, or a
 * future schema change), it is parsed as-is rather than double-suffixed.
 */
export function parsePgTimestamp(value: string): Date {
  // Has a trailing `Z`, `+hh:mm`, `-hh:mm`, `+hhmm`, or `-hhmm` → already anchored.
  return /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value) ? new Date(value) : new Date(`${value}Z`);
}

/**
 * Quote a value for embedding inside a PostgREST `or`/`and` filter expression so that
 * commas, parentheses, and quotes inside the value don't break the expression structure.
 * PostgREST uses `,` to separate `or`/`and` items and `()` for nesting, so an unquoted
 * value containing either would mis-parse. Use for values inside strings passed to
 * `.or("col.op.<quote(v)>,...")` — e.g. search terms in a multi-column `ilike` OR.
 */
export function pgQuote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Unwrap a `head: true, count: "exact"` count query: throw on error, return the row
 * count (0 when null). Use for `.select("id", { count: "exact", head: true })` shapes
 * that only need the count, not the rows.
 */
export async function unwrapCount<
  R extends {
    count: number | null;
    error: { code: string; message: string } | null;
  },
>(query: PromiseLike<R>): Promise<number> {
  const r = await query;
  if (r.error) {
    throw new Error(`PostgREST error [${r.error.code}]: ${r.error.message}`);
  }
  return r.count ?? 0;
}
