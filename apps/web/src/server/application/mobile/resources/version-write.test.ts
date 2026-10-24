// @vitest-environment node
import { expect, it, vi } from "vitest";
import { branded } from "@/types/ids";
const b = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/server/infrastructure/db/client", () => ({
  getDataClient: () => ({
    from: () => {
      const q = {
        update: (v: unknown) => {
          b.update(v);
          return q;
        },
        eq: () => q,
        is: () => q,
        select: async () => ({
          data: [{ id: "11111111-1111-4111-8111-111111111111" }],
          error: null,
        }),
      };
      return q;
    },
  }),
}));
vi.mock("@/server/infrastructure/events/index", () => ({ publishEvent: vi.fn() }));
import { updateCustomer } from "@/server/foundation/customers/index";
it("passes the expected version to the database update trigger", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  await updateCustomer(
    branded<"WorkspaceId">(id),
    branded<"CustomerId">(id),
    { name: "Edited" },
    branded<"UserId">(id),
    "2026-10-25T00:00:00.000Z",
  );
  expect(b.update).toHaveBeenCalledWith(
    expect.objectContaining({
      mobile_expected_updated_at: "2026-10-25T00:00:00.000Z",
      name: "Edited",
    }),
  );
});
