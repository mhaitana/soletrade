import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupWorkspaces, seedUsers } from "@/tests/db-helpers";
import { branded, type CustomerId, type WorkspaceId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
} from "@/platform/customers";

/**
 * Integration tests for the customers service against a real Postgres.
 *
 * These run ONLY when DATABASE_URL is set (e.g. against a local Supabase or a
 * throwaway test database). Without it, `pnpm test:ci` skips this file so the
 * unit suite stays green in any environment.
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 *
 * The tests create their own user + workspace rows with unique slugs and clean
 * up everything they created in `afterAll`.
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("customers integration (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-4000-8000-000000000001");
  const otherActor = branded<"UserId">("00000000-0000-4000-8000-000000000002");
  let ws1: WorkspaceId;
  let ws2: WorkspaceId;
  const createdCustomerIds: CustomerId[] = [];

  beforeAll(async () => {
    // Two users + two workspaces. createWorkspace inserts the owner membership
    // and an audit_logs row; we clean both in afterAll.
    await seedUsers([
      { id: actor, email: "actor@soletrade-test.local", fullName: "Test Actor" },
      { id: otherActor, email: "other@soletrade-test.local", fullName: "Test Other" },
    ]);
    ws1 = await createWorkspace(actor, "Acme Test One", `acme-test-one-${Date.now()}`);
    ws2 = await createWorkspace(otherActor, "Acme Test Two", `acme-test-two-${Date.now()}`);
  });

  afterAll(async () => {
    const workspaceIds = [ws1, ws2].filter(Boolean) as WorkspaceId[];
    await cleanupWorkspaces(
      workspaceIds,
      [actor, otherActor],
      [{ table: "customers" }, { table: "audit_logs" }],
    );
  });

  it("creates a customer and lists it", async () => {
    const id = await createCustomer(ws1!, { name: "Jane Smith", email: "JANE@example.com" }, actor);
    createdCustomerIds.push(id);
    const list = await listCustomers(ws1!);
    expect(list.some((c) => c.id === id && c.name === "Jane Smith")).toBe(true);
  });

  it("normalises email to lowercase on create", async () => {
    const list = await listCustomers(ws1!);
    const jane = list.find((c) => c.name === "Jane Smith");
    expect(jane?.email).toBe("jane@example.com");
  });

  it("isolates customers per workspace (no IDOR)", async () => {
    // ws2 should not see ws1's customer via list…
    const ws2List = await listCustomers(ws2!);
    expect(ws2List.find((c) => c.name === "Jane Smith")).toBeUndefined();

    // …nor via the workspace-scoped getter.
    const jane = await listCustomers(ws1!).then((l) => l.find((c) => c.name === "Jane Smith")!);
    const fromWrongWorkspace = await getCustomer(ws2!, jane.id);
    expect(fromWrongWorkspace).toBeNull();
    const fromRightWorkspace = await getCustomer(ws1!, jane.id);
    expect(fromRightWorkspace?.id).toBe(jane.id);
  });

  it("allows multiple customers with no email (NULLs are distinct)", async () => {
    const a = await createCustomer(ws1!, { name: "Walk-in A" }, actor);
    const b = await createCustomer(ws1!, { name: "Walk-in B" }, actor);
    createdCustomerIds.push(a, b);
    const list = await listCustomers(ws1!);
    expect(list.some((c) => c.id === a)).toBe(true);
    expect(list.some((c) => c.id === b)).toBe(true);
  });

  it("rejects a duplicate email within the same workspace", async () => {
    // The service surfaces the underlying Postgres unique-violation error.
    const causeMessage = (err: unknown) => {
      const e = err as { message?: string; cause?: { message?: string } };
      return `${e.message ?? ""} ${e.cause?.message ?? ""}`;
    };
    try {
      await createCustomer(ws1!, { name: "Dup", email: "jane@example.com" }, actor);
      expect.unreachable("createCustomer should have thrown for a duplicate email");
    } catch (err) {
      expect(causeMessage(err)).toMatch(/unique|duplicate/i);
    }
  });

  it("updates a customer and reflects the change", async () => {
    const before = await listCustomers(ws1!).then((l) => l.find((c) => c.name === "Jane Smith")!);
    await updateCustomer(ws1!, before.id, { name: "Jane Smyth", company: "Acme" }, actor);
    const after = await getCustomer(ws1!, before.id);
    expect(after?.name).toBe("Jane Smyth");
    expect(after?.company).toBe("Acme");
  });

  it("soft-deletes a customer and hides it from listings", async () => {
    const target = await listCustomers(ws1!).then((l) => l.find((c) => c.name === "Walk-in A")!);
    await deleteCustomer(ws1!, target.id, actor);
    const after = await getCustomer(ws1!, target.id);
    expect(after).toBeNull();
    const list = await listCustomers(ws1!);
    expect(list.find((c) => c.id === target.id)).toBeUndefined();
  });

  it("rejects updates targeting a customer in another workspace", async () => {
    const jane = await listCustomers(ws1!).then((l) => l.find((c) => c.name === "Jane Smyth")!);
    await expect(updateCustomer(ws2!, jane.id, { name: "Hijacked" }, otherActor)).rejects.toThrow(
      /not found/i,
    );
  });
});
