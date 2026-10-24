import type { SessionUser } from "@/lib/domain/auth/session-types";
import type { WorkspaceRole } from "@/lib/domain/database-enums";
import type { WorkspaceId } from "@/types/ids";

export interface WorkspaceContext {
  user: SessionUser;
  workspaceId: WorkspaceId;
  role: WorkspaceRole;
}
