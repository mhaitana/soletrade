// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

/**
 * Reading a receipt is a model call, so it goes in the usage ledger like a chat turn.
 * Everything around the model (files, billing, the database, events) is stubbed; the
 * model is a scripted one driven through the real `generateText`.
 */

const mocks = vi.hoisted(() => ({
  recordAiUsage: vi.fn(),
  mockProvider: false,
  modelFails: false,
  /** What the model writes back; null means a well-formed receipt. */
  answer: null as { text: string; finish: "stop" | "length" } | null,
  inserted: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/infrastructure/config/env", () => ({
  env: { RECEIPT_EXTRACTION_COST_CENTS: 0 },
}));
vi.mock("@/server/foundation/billing/state", () => ({
  getBillingState: async () => ({ provider: "stripe", status: "active", paidThrough: null }),
}));
vi.mock("@/server/foundation/billing/credits", () => ({
  consumeCredit: vi.fn(),
  reverseCreditConsumption: vi.fn(),
}));
vi.mock("@/server/foundation/files", () => ({
  getFile: async () => ({ storagePath: "w/r.png", mimeType: "image/png", fileName: "r.png" }),
  downloadFileBytes: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }),
}));
vi.mock("@/server/foundation/workspaces", () => ({
  getWorkspace: async () => ({ defaultCurrency: "AUD" }),
}));
vi.mock("@/server/foundation/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/server/infrastructure/events", () => ({ publishEvent: vi.fn() }));
vi.mock("@/server/foundation/ai-usage/usage", () => ({ recordAiUsage: mocks.recordAiUsage }));
vi.mock("@/server/infrastructure/db/client", () => ({
  getDataClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        mocks.inserted.push(row);
        return { select: async () => ({ data: [{ id: "extraction-1" }], error: null }) };
      },
    }),
  }),
}));

const receipt = {
  merchant: "Bunnings",
  date: "2026-11-18",
  totalCents: 4_250,
  taxCents: 386,
  currency: "AUD",
  category: "supplies",
  lineItems: [],
  confidence: 0.9,
};

const visionModel = new MockLanguageModelV4({
  provider: "anthropic.messages",
  modelId: "vision-test",
  doGenerate: async () => {
    if (mocks.modelFails) throw new Error("provider unavailable");
    return {
      content: [{ type: "text" as const, text: mocks.answer?.text ?? JSON.stringify(receipt) }],
      finishReason: { unified: mocks.answer?.finish ?? ("stop" as const), raw: undefined },
      usage: {
        inputTokens: { total: 1_500, noCache: 1_500, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 120, text: 120, reasoning: 0 },
      },
      warnings: [],
    };
  },
});

vi.mock("@/server/infrastructure/ai/provider", () => ({
  aiModelLabel: () => "anthropic/vision-test",
  getAIModel: () => visionModel,
  isMockProvider: () => mocks.mockProvider,
}));

import { extractReceipt } from "@/server/domains/books/receipt-extraction";

const workspaceId = "00000000-0000-4000-8000-00000000a001" as never;
const fileId = "00000000-0000-4000-8000-00000000a004" as never;
const actorId = "00000000-0000-4000-8000-00000000a002" as never;

beforeEach(() => {
  mocks.recordAiUsage.mockReset().mockResolvedValue(undefined);
  mocks.mockProvider = false;
  mocks.modelFails = false;
  mocks.answer = null;
  mocks.inserted = [];
});

const receiptUsage = {
  workspaceId,
  userId: actorId,
  feature: "receipt",
  provider: "anthropic",
  model: "vision-test",
  inputTokens: 1_500,
  outputTokens: 120,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  steps: 1,
};

describe("receipt extraction and the usage ledger", () => {
  it("records what reading a receipt used, for the workspace and the person who asked", async () => {
    await extractReceipt(workspaceId, fileId, actorId);
    expect(mocks.recordAiUsage).toHaveBeenCalledTimes(1);
    expect(mocks.recordAiUsage).toHaveBeenCalledWith(receiptUsage);
    // The extraction itself is stored as before.
    expect(mocks.inserted[0]).toMatchObject({
      status: "pending",
      extracted_data: expect.objectContaining({ merchant: "Bunnings", totalCents: 4_250 }),
    });
  });

  it("records nothing when no real model was called", async () => {
    mocks.mockProvider = true;
    await extractReceipt(workspaceId, fileId, actorId);
    expect(mocks.recordAiUsage).not.toHaveBeenCalled();
    expect(mocks.inserted[0]).toMatchObject({ status: "pending" });
  });

  it("records a read whose answer could not be understood: it was billed all the same", async () => {
    // The model finished, but what it wrote is not the receipt it was asked for.
    mocks.answer = { text: "I can't make out this receipt, sorry.", finish: "stop" };
    await extractReceipt(workspaceId, fileId, actorId);
    expect(mocks.recordAiUsage).toHaveBeenCalledTimes(1);
    expect(mocks.recordAiUsage).toHaveBeenCalledWith(receiptUsage);
    expect(mocks.inserted[0]).toMatchObject({ status: "rejected", extracted_data: null });
  });

  it("records a read whose answer does not match what a receipt needs", async () => {
    mocks.answer = { text: JSON.stringify({ merchant: "Bunnings" }), finish: "stop" };
    await extractReceipt(workspaceId, fileId, actorId);
    expect(mocks.recordAiUsage).toHaveBeenCalledTimes(1);
    expect(mocks.recordAiUsage).toHaveBeenCalledWith(receiptUsage);
    expect(mocks.inserted[0]).toMatchObject({ status: "rejected" });
  });

  it("records a read that was cut off before the model finished", async () => {
    mocks.answer = { text: '{"merchant":"Bunn', finish: "length" };
    await extractReceipt(workspaceId, fileId, actorId);
    expect(mocks.recordAiUsage).toHaveBeenCalledTimes(1);
    expect(mocks.recordAiUsage).toHaveBeenCalledWith(receiptUsage);
    expect(mocks.inserted[0]).toMatchObject({ status: "rejected" });
  });

  it("records nothing for a request the provider never answered, and still stores the failure", async () => {
    mocks.modelFails = true;
    await extractReceipt(workspaceId, fileId, actorId);
    expect(mocks.recordAiUsage).not.toHaveBeenCalled();
    expect(mocks.inserted[0]).toMatchObject({
      status: "rejected",
      error_message: "provider unavailable",
    });
  });
});
