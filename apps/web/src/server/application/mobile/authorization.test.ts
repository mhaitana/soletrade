import { beforeEach, describe, expect, it, vi } from "vitest";
import { branded } from "@/types/ids";
const enabled = vi.hoisted(() => vi.fn());
vi.mock("@/server/foundation/module-installations/index", () => ({ isModuleEnabled: enabled }));
import { authorizeMobileOperation } from "@/server/application/mobile/authorization";
const ctx = {
  user: {
    id: branded<"UserId">("11111111-1111-4111-8111-111111111111"),
    email: "test@test.invalid",
  },
  workspaceId: branded<"WorkspaceId">("22222222-2222-4222-8222-222222222222"),
  role: "owner" as const,
};
beforeEach(() => enabled.mockResolvedValue(true));
describe("authorization before operation cache replay", () => {
  it("rejects a disabled module even for an existing owner's cached operation", async () => {
    enabled.mockResolvedValue(false);
    await expect(
      authorizeMobileOperation(ctx, ["books", "transactions"], "POST"),
    ).rejects.toMatchObject({ status: 404, code: "MODULE_UNAVAILABLE" });
  });
  it("rejects writes after a member becomes readonly", async () => {
    await expect(
      authorizeMobileOperation({ ...ctx, role: "readonly" }, ["invoices"], "POST"),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("permits employee invoice drafts but not sending them", async () => {
    await expect(
      authorizeMobileOperation({ ...ctx, role: "employee" }, ["invoices"], "POST"),
    ).resolves.toBeUndefined();
    await expect(
      authorizeMobileOperation(
        { ...ctx, role: "employee" },
        ["invoices", "some-id", "send"],
        "POST",
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
