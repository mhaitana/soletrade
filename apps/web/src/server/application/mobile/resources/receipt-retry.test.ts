// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { branded } from "@/types/ids";
const b = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  charge: vi.fn(),
  billing: vi.fn(),
  audit: vi.fn(),
  publish: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/server/infrastructure/config/env", () => ({
  env: { RECEIPT_EXTRACTION_COST_CENTS: 25, AI_PROVIDER: "mock" },
}));
vi.mock("@/server/infrastructure/ai/provider", () => ({
  isMockProvider: () => true,
  getAIModel: vi.fn(),
  aiModelLabel: () => "mock",
}));
vi.mock("@/server/foundation/billing/state", () => ({ getBillingState: b.billing }));
vi.mock("@/server/foundation/billing/credits", () => ({ consumeCredit: b.charge }));
vi.mock("@/server/foundation/workspaces/index", () => ({
  getWorkspace: async () => ({ defaultCurrency: "AUD" }),
}));
vi.mock("@/server/foundation/files/index", () => ({
  getFile: async () => ({ storagePath: "file", mimeType: "image/jpeg", fileName: "receipt.jpg" }),
  downloadFileBytes: vi.fn(),
}));
vi.mock("@/server/foundation/audit/index", () => ({ writeAudit: b.audit }));
vi.mock("@/server/infrastructure/events/index", () => ({ publishEvent: b.publish }));
vi.mock("@/server/infrastructure/db/client", () => ({
  getDataClient: () => ({
    rpc: b.rpc,
    from: () => {
      const filters: Record<string, unknown> = {};
      let operation = "read";
      let payload: Record<string, unknown> = {};
      const execute = () => {
        const found = [...b.rows.values()].find((row) =>
          Object.entries(filters).every(([key, value]) => row[key] === value),
        );
        if (operation === "insert") {
          const id = String(payload.id);
          if (b.rows.has(id)) return { data: null, error: { code: "23505", message: "duplicate" } };
          const row = {
            created_at: "2026-10-25T00:00:00Z",
            updated_at: "2026-10-25T00:00:00Z",
            transaction_id: null,
            extracted_data: null,
            error_message: null,
            ...payload,
          };
          b.rows.set(id, row);
          return { data: [row], error: null };
        }
        if (operation === "update") {
          if (!found) return { data: [], error: null };
          Object.assign(found, payload);
          return { data: [found], error: null };
        }
        return { data: found ? [found] : [], error: null };
      };
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return builder;
        },
        limit: () => builder,
        insert: (value: Record<string, unknown>) => {
          operation = "insert";
          payload = value;
          return builder;
        },
        update: (value: Record<string, unknown>) => {
          operation = "update";
          payload = value;
          return builder;
        },
        maybeSingle: async () => {
          const r = execute();
          return { ...r, data: r.data?.[0] ?? null };
        },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(execute()).then(resolve),
      };
      return builder;
    },
  }),
}));
import { extractReceipt, getExtraction } from "@/server/domains/books/receipt-extraction";
const workspaceId = branded<"WorkspaceId">("11111111-1111-4111-8111-111111111111");
const userId = branded<"UserId">("22222222-2222-4222-8222-222222222222");
const fileId = branded<"FileId">("33333333-3333-4333-8333-333333333333");
const operationId = branded<"ReceiptExtractionId">("44444444-4444-4444-8444-444444444444");
beforeEach(() => {
  vi.clearAllMocks();
  b.rows.clear();
  b.charge.mockResolvedValue(undefined);
  b.billing.mockResolvedValue({ provider: "stripe", status: "active", paidThrough: null });
});
describe("receipt extraction retry safety", () => {
  it("claims a deterministic row before charging and recovers the completed extraction without charging again", async () => {
    b.charge.mockImplementation(async () => {
      expect(b.rows.get(operationId)?.processing).toBe(true);
    });
    expect(await extractReceipt(workspaceId, fileId, userId, operationId)).toBe(operationId);
    expect(await extractReceipt(workspaceId, fileId, userId, operationId)).toBe(operationId);
    expect(b.charge).toHaveBeenCalledTimes(1);
    expect(b.publish).toHaveBeenCalledTimes(1);
    expect((await getExtraction(workspaceId, operationId))?.processing).toBe(false);
  });
  it("does not retry charged work when the first worker is still processing", async () => {
    b.rows.set(operationId, {
      id: operationId,
      workspace_id: workspaceId,
      file_id: fileId,
      status: "pending",
      processing: true,
      model_used: "mock",
      created_at: "2026-10-25T00:00:00Z",
      updated_at: "2026-10-25T00:00:00Z",
    });
    expect(await extractReceipt(workspaceId, fileId, userId, operationId)).toBe(operationId);
    expect(b.charge).not.toHaveBeenCalled();
  });
  it("includes receipt OCR throughout valid store-paid coverage", async () => {
    b.billing.mockResolvedValue({
      provider: "apple",
      status: "canceled",
      paidThrough: "2099-01-01T00:00:00Z",
    });
    await extractReceipt(workspaceId, fileId, userId, operationId);
    expect(b.charge).not.toHaveBeenCalled();
    expect(b.rows.get(operationId)?.extracted_data).toBeTruthy();
  });
});
