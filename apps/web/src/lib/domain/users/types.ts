import type { UserId } from "@/types/ids";

export interface UserMirrorRow {
  id: UserId;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export interface EnsureUserMirrorInput {
  id: UserId;
  email: string;
  /** Optional - when omitted, an existing full_name is preserved (not nulled). */
  fullName?: string | null;
}
