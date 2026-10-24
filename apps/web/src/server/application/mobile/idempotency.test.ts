import { beforeEach, describe, expect, it, vi } from "vitest";
import { branded } from "@/types/ids";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), update: vi.fn() }));
vi.mock("@/server/infrastructure/db/client", () => ({
  getDataClient: () => ({
    rpc: mock.rpc,
    from: () => ({ update: () => ({ eq: () => ({ eq: mock.update }) }) }),
  }),
}));
import {
  runMobileMutation,
  runMobileStream,
  type MobileWorkspaceContext,
} from "@/server/application/mobile/http";
import { createOnce } from "@/server/application/mobile/resources/common";
const operationId = "33333333-3333-4333-8333-333333333333";
const ctx = {
  user: {
    id: branded<"UserId">("11111111-1111-4111-8111-111111111111"),
    email: "test@test.invalid",
  },
  workspaceId: branded<"WorkspaceId">("22222222-2222-4222-8222-222222222222"),
  role: "owner" as const,
};
const request = () =>
  new Request("https://test.invalid/api/v1/workspaces/x/books/transactions", {
    method: "POST",
    headers: { "idempotency-key": operationId },
  });
beforeEach(() => {
  vi.clearAllMocks();
  mock.update.mockResolvedValue({ error: null });
});
describe("durable mobile write and stream coordination", () => {
  it("recovers a committed financial create after response completion was lost", async () => {
    const records = new Map<string, { id: string }>();
    let inserts = 0;
    const work = (context: MobileWorkspaceContext) =>
      createOnce(
        context,
        async (id) => records.get(id) ?? null,
        async (id) => {
          inserts++;
          records.set(id!, { id: id! });
          return id!;
        },
      );
    mock.rpc
      .mockResolvedValueOnce({ data: { state: "claimed" }, error: null })
      .mockResolvedValueOnce({ data: { state: "pending" }, error: null });
    mock.update
      .mockResolvedValueOnce({ error: { message: "connection lost" } })
      .mockResolvedValueOnce({ error: null });
    const operation = `workspaces/${ctx.workspaceId}/books/transactions`;
    await expect(
      runMobileMutation(request(), ctx, operation, { amountCents: 100 }, work),
    ).rejects.toThrow("record mobile operation");
    expect(await runMobileMutation(request(), ctx, operation, { amountCents: 100 }, work)).toEqual({
      id: operationId,
    });
    expect(inserts).toBe(1);
  });
  it("never repeats an uncertain document send", async () => {
    mock.rpc.mockResolvedValue({ data: { state: "pending" }, error: null });
    const work = vi.fn();
    await expect(
      runMobileMutation(request(), ctx, "workspaces/x/invoices/y/send", {}, work),
    ).rejects.toMatchObject({ code: "OPERATION_PENDING", status: 409 });
    expect(work).not.toHaveBeenCalled();
  });
  it("does not append or run tools for an accepted assistant turn retry", async () => {
    mock.rpc.mockResolvedValue({ data: { state: "pending" }, error: null });
    const work = vi.fn();
    await expect(
      runMobileStream(
        request(),
        ctx,
        "workspaces/x/assistant/conversations/y/messages",
        { message: "Confirm expense" },
        work,
      ),
    ).rejects.toMatchObject({ code: "ASSISTANT_TURN_ACCEPTED", status: 409 });
    expect(work).not.toHaveBeenCalled();
  });
});
