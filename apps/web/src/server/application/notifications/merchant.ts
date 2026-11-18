import "server-only";
import { getWorkspace } from "@/server/foundation/workspaces/index";
import type { WorkspaceId } from "@/types/ids";

/**
 * The name customers know the workspace by, for customer-facing emails. Best effort: an
 * email without the business name is still better than no email, so a failed lookup
 * returns null and the templates fall back to their generic wording.
 */
export async function resolveMerchantName(workspaceId: WorkspaceId): Promise<string | null> {
  try {
    const workspace = await getWorkspace(workspaceId);
    const name = workspace?.name?.trim();
    return name ? name : null;
  } catch (err) {
    console.error("[notifications] could not load the workspace name for an email:", err);
    return null;
  }
}
