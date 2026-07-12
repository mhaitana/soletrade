import { describe, expect, it } from "vitest";
import { branded } from "@/shared/types/ids";
import { updateMemberRole } from "./index";

/**
 * Unit tests for the pure guards in `updateMemberRole` that run before any DB
 * access (invalid role, self-change). The owner / last-admin guards hit the DB
 * and are covered by `members.integration.test.ts` (DB-gated).
 */
describe("updateMemberRole - pure guards", () => {
  const ws = branded<"WorkspaceId">("00000000-0000-4000-8000-00000000d000");
  const actor = branded<"UserId">("00000000-0000-4000-8000-0000000000d1");
  const target = branded<"UserId">("00000000-0000-4000-8000-0000000000d2");

  it("refuses an invalid role (owner can't be assigned here)", async () => {
    await expect(updateMemberRole(ws, target, "owner" as never, actor)).rejects.toThrow(
      /Invalid role/,
    );
  });

  it("refuses a self role-change", async () => {
    await expect(updateMemberRole(ws, actor, "admin", actor)).rejects.toThrow(/own role/);
  });
});
