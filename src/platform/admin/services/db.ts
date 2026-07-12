import "server-only";
import { getDataClient } from "@/server/db/client";

/**
 * Accessor for admin tables before local Supabase types regeneration.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAdminDb(): any {
  return getDataClient();
}
