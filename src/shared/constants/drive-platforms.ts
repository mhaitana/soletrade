/**
 * Drive platform catalog (Phase 7). Pure data + lookup helpers - no `server-only`, no
 * app/module/platform imports, so both the client form and the server action/service can
 * import it without dragging server-only into the client bundle. Mirrors the
 * `src/shared/constants/books-categories` pattern: data only (validation lives in the
 * action/service, satisfying "no business logic in `src/shared/*`").
 *
 * Platforms are slugs (`key`) + human labels. Stored on `drive_earnings.platform` and
 * `drive_trips.platform` as `text` (not a DB enum) so this seed list can grow without a
 * migration. The `other` slug is the catch-all for platforms not yet in the seed list.
 */
export interface DrivePlatform {
  /** Stable slug stored on the row. */
  key: string;
  /** Human label shown in the UI. */
  label: string;
}

export const DRIVE_PLATFORMS = [
  { key: "uber", label: "Uber" },
  { key: "uber_eats", label: "Uber Eats" },
  { key: "doordash", label: "DoorDash" },
  { key: "airtasker", label: "Airtasker" },
  { key: "menulog", label: "Menulog" },
  { key: "lyft", label: "Lyft" },
  { key: "instacart", label: "Instacart" },
  { key: "other", label: "Other" },
] as const satisfies readonly DrivePlatform[];

/** True if `key` is a valid platform slug. */
export function isDrivePlatform(key: string): boolean {
  return DRIVE_PLATFORMS.some((p) => p.key === key);
}

/** Human label for a stored slug, or `null` if it isn't in the catalog. */
export function platformLabel(key: string): string | null {
  return DRIVE_PLATFORMS.find((p) => p.key === key)?.label ?? null;
}
