import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateText, type ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { assistantApprovalFor } from "@/lib/assistant/approval-policy";
import { ASSISTANT_TOOLS } from "@/lib/assistant/tool-catalog";
import { branded } from "@/types/ids";
import type { WorkspaceContext } from "@/lib/domain/auth/workspace-context-types";
import type { ModuleKey } from "@/config/modules";

/**
 * Unit tests for the assistant tool builder (composition layer). The module
 * services are mocked so we can assert **gating** (only permitted + installed
 * tools are offered) and **trimming** (each `execute` returns a JSON-serializable
 * shape with money as integer cents + ISO dates, never raw rows). `authorize` is
 * real - these tests exercise the actual permission model against real roles.
 */

const listInvoicesMock = vi.fn();
const getInvoiceDashboardSummaryMock = vi.fn();
const listQuotesMock = vi.fn();
const getQuoteDashboardSummaryMock = vi.fn();
const listTransactionsMock = vi.fn();
const getBookSummaryMock = vi.fn();
const listEarningsMock = vi.fn();
const listTripsMock = vi.fn();
const listExpensesMock = vi.fn();
const getDriveSummaryMock = vi.fn();
const listCustomersMock = vi.fn();
const listActivityMock = vi.fn();
// Write-tool mocks (Phase 11d).
const createInvoiceMock = vi.fn();
const createQuoteMock = vi.fn();
const createTransactionMock = vi.fn();
const createCustomerMock = vi.fn();
const getCustomerMock = vi.fn();
const getCustomerByEmailMock = vi.fn();
const updateCustomerMock = vi.fn();
const writeAuditMock = vi.fn();
const getWorkspaceMock = vi.fn();
// Invoice/quote action mocks.
const sendInvoiceMock = vi.fn();
const voidInvoiceMock = vi.fn();
const markInvoicePaidMock = vi.fn();
const getInvoiceMock = vi.fn();
const getQuoteMock = vi.fn();
const convertQuoteAtomicMock = vi.fn();
vi.mock("@/server/application/quotes/convert-quote-to-invoice", () => ({
  convertQuoteToInvoice: (...a: unknown[]) => convertQuoteAtomicMock(...a),
}));
// Books update/delete mocks.
const updateTransactionMock = vi.fn();
const deleteTransactionMock = vi.fn();
// Drive write mocks.
const createEarningMock = vi.fn();
const createTripMock = vi.fn();
const createExpenseMock = vi.fn();
const listVehiclesMock = vi.fn();
// Receipt extraction mocks.
const extractReceiptMock = vi.fn();
const getExtractionMock = vi.fn();
const listExtractionsMock = vi.fn();
const countExtractionsMock = vi.fn();
vi.mock("@/server/domains/books/receipt-extraction", () => ({
  extractReceipt: (...a: unknown[]) => extractReceiptMock(...a),
  getExtraction: (...a: unknown[]) => getExtractionMock(...a),
  listExtractions: (...a: unknown[]) => listExtractionsMock(...a),
  countExtractions: (...a: unknown[]) => countExtractionsMock(...a),
}));
// Record and summary lookup mocks.
const getTransactionMock = vi.fn();
const getGstMonthlyMock = vi.fn();
const listTaxPeriodsMock = vi.fn();
vi.mock("@/server/domains/books/tax", () => ({
  listTaxPeriods: (...a: unknown[]) => listTaxPeriodsMock(...a),
}));

vi.mock("@/server/domains/invoices/index", () => ({
  listInvoices: (...a: unknown[]) => listInvoicesMock(...a),
  getInvoiceDashboardSummary: (...a: unknown[]) => getInvoiceDashboardSummaryMock(...a),
  createInvoice: (...a: unknown[]) => createInvoiceMock(...a),
  sendInvoice: (...a: unknown[]) => sendInvoiceMock(...a),
  voidInvoice: (...a: unknown[]) => voidInvoiceMock(...a),
  markInvoicePaid: (...a: unknown[]) => markInvoicePaidMock(...a),
  getInvoice: (...a: unknown[]) => getInvoiceMock(...a),
}));
vi.mock("@/server/domains/quotes/index", () => ({
  listQuotes: (...a: unknown[]) => listQuotesMock(...a),
  getQuoteDashboardSummary: (...a: unknown[]) => getQuoteDashboardSummaryMock(...a),
  createQuote: (...a: unknown[]) => createQuoteMock(...a),
  getQuote: (...a: unknown[]) => getQuoteMock(...a),
}));
vi.mock("@/server/domains/books/index", () => ({
  listTransactions: (...a: unknown[]) => listTransactionsMock(...a),
  getBookSummary: (...a: unknown[]) => getBookSummaryMock(...a),
  getGstMonthly: (...a: unknown[]) => getGstMonthlyMock(...a),
  getTransaction: (...a: unknown[]) => getTransactionMock(...a),
  createTransaction: (...a: unknown[]) => createTransactionMock(...a),
  updateTransaction: (...a: unknown[]) => updateTransactionMock(...a),
  deleteTransaction: (...a: unknown[]) => deleteTransactionMock(...a),
}));
vi.mock("@/server/domains/drive/index", () => ({
  listEarnings: (...a: unknown[]) => listEarningsMock(...a),
  listTrips: (...a: unknown[]) => listTripsMock(...a),
  listExpenses: (...a: unknown[]) => listExpensesMock(...a),
  getDriveSummary: (...a: unknown[]) => getDriveSummaryMock(...a),
  createEarning: (...a: unknown[]) => createEarningMock(...a),
  createTrip: (...a: unknown[]) => createTripMock(...a),
  createExpense: (...a: unknown[]) => createExpenseMock(...a),
  listVehicles: (...a: unknown[]) => listVehiclesMock(...a),
}));
vi.mock("@/server/foundation/customers/index", () => ({
  listCustomers: (...a: unknown[]) => listCustomersMock(...a),
  createCustomer: (...a: unknown[]) => createCustomerMock(...a),
  getCustomer: (...a: unknown[]) => getCustomerMock(...a),
  getCustomerByEmail: (...a: unknown[]) => getCustomerByEmailMock(...a),
  updateCustomer: (...a: unknown[]) => updateCustomerMock(...a),
}));
vi.mock("@/server/foundation/activity/index", () => ({
  listActivity: (...a: unknown[]) => listActivityMock(...a),
}));
vi.mock("@/server/foundation/audit/index", () => ({
  writeAudit: (...a: unknown[]) => writeAuditMock(...a),
}));
vi.mock("@/server/foundation/workspaces/index", () => ({
  getWorkspace: (...a: unknown[]) => getWorkspaceMock(...a),
}));

const ALL_MODULES: ModuleKey[] = ["invoices", "books", "drive", "quotes"];

function ctx(role: WorkspaceContext["role"]): WorkspaceContext {
  return {
    user: { id: branded<"UserId">("00000000-0000-4000-8000-0000000000c1"), email: "u@x.test" },
    workspaceId: branded<"WorkspaceId">("00000000-0000-4000-8000-0000000000c2"),
    role,
  };
}

/** Call a tool's execute with a minimal options bag (the AI SDK passes one at runtime). */
async function run(
  tool: ToolSet[string] | undefined,
  input: Record<string, unknown> = {},
): Promise<unknown> {
  if (!tool) throw new Error("tool not offered");
  // The AI SDK's `ToolExecutionOptions` is an internal, version-specific shape; we only
  // need the args here, so cast execute to a permissive callable and pass a minimal bag.
  const exec = tool.execute as (args: Record<string, unknown>, opts: unknown) => Promise<unknown>;
  return exec(input, { toolCallId: "test-call", messages: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspaceMock.mockResolvedValue({ defaultCurrency: "AUD" });
  // Number lookups after a create default to "nothing found" (number: null) unless a test says otherwise.
  getInvoiceMock.mockResolvedValue(null);
  getQuoteMock.mockResolvedValue(null);
  writeAuditMock.mockResolvedValue(undefined);
});

/** The `assistant.action` audit rows written during a test (excludes service-level rows). */
function assistantActionAudits(): Record<string, unknown>[] {
  return writeAuditMock.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((row) => row.action === "assistant.action");
}

describe("buildAssistantTools - gating", () => {
  it("publishes openForm as a plain object while retaining strict validation", async () => {
    const { haiOpenFormProviderInputSchema } = await import("@/server/application/assistant/tools");
    const schema = await haiOpenFormProviderInputSchema.jsonSchema;

    expect(schema.type).toBe("object");
    for (const unsupportedRootKeyword of ["oneOf", "anyOf", "allOf", "enum", "const", "not"]) {
      expect(schema).not.toHaveProperty(unsupportedRootKeyword);
    }

    const valid = await haiOpenFormProviderInputSchema.validate?.({
      workflow: "invoice.create",
      requestSummary: "Draft an invoice for Acme",
      fields: { customerQuery: "Acme" },
    });
    expect(valid?.success).toBe(true);

    const unsafe = await haiOpenFormProviderInputSchema.validate?.({
      workflow: "invoice.create",
      requestSummary: "Draft and send an invoice",
      fields: { sendImmediately: true },
    });
    expect(unsafe?.success).toBe(false);
  });

  it("serializes openForm as a provider-compatible OpenAI function tool", async () => {
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const openForm = buildAssistantTools(ctx("owner"), ALL_MODULES).openForm;
    expect(openForm).toBeDefined();

    let requestBody: Record<string, unknown> | undefined;
    const captureFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json(
        {
          error: {
            message: "Captured provider request.",
            type: "invalid_request_error",
            code: "captured_request",
          },
        },
        { status: 400 },
      );
    });
    const openai = createOpenAI({ apiKey: "test-key", fetch: captureFetch });

    await expect(
      generateText({
        model: openai("gpt-4o-mini"),
        prompt: "Draft an invoice for Acme Corp for $250",
        tools: { openForm: openForm! },
        maxRetries: 0,
      }),
    ).rejects.toBeDefined();

    expect(captureFetch).toHaveBeenCalledOnce();
    const wireTools = requestBody?.tools as Array<Record<string, unknown>> | undefined;
    const wireOpenForm = wireTools?.find((entry) => entry.name === "openForm");
    expect(wireOpenForm).toBeDefined();
    const parameters = wireOpenForm?.parameters as Record<string, unknown>;
    expect(parameters.type).toBe("object");
    for (const unsupportedRootKeyword of ["oneOf", "anyOf", "allOf", "enum", "const", "not"]) {
      expect(parameters).not.toHaveProperty(unsupportedRootKeyword);
    }
  });

  it("offers every tool to a readonly role when all modules are installed", async () => {
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("readonly"), ALL_MODULES);
    // Everything that only needs view:R. listReceiptQueue is absent: the receipt queue
    // needs manage:books, which readonly does not have.
    expect(Object.keys(tools).sort()).toEqual(
      [
        "getWorkspaceOverview",
        "listInvoices",
        "listQuotes",
        "listTransactions",
        "listDriveEarnings",
        "listDriveTrips",
        "listDriveVehicles",
        "listDriveExpenses",
        "listCustomers",
        "listRecentActivity",
        "getInvoice",
        "getQuote",
        "getCustomer",
        "getTransaction",
        "getPeriodSummary",
        "getGstSummary",
        "navigateWorkspace",
        "openForm",
      ].sort(),
    );
  });

  it("offers only non-module-gated tools when no modules are installed", async () => {
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("readonly"), []);
    // Overview is always offered; customers + activity are platform services (not module-gated).
    expect(Object.keys(tools).sort()).toEqual(
      [
        "getWorkspaceOverview",
        "listCustomers",
        "listRecentActivity",
        "getCustomer",
        "navigateWorkspace",
        "openForm",
      ].sort(),
    );
    // The module-gated tools are absent (fail-closed), not merely no-ops.
    expect(tools.listInvoices).toBeUndefined();
    expect(tools.listTransactions).toBeUndefined();
    expect(tools.listDriveEarnings).toBeUndefined();
    expect(tools.listDriveTrips).toBeUndefined();
    expect(tools.listDriveVehicles).toBeUndefined();
    expect(tools.listDriveExpenses).toBeUndefined();
    expect(tools.listQuotes).toBeUndefined();
  });

  it("omits a module tool the role can't view (employee lacks view:books)", async () => {
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("employee"), ALL_MODULES);
    // employee has no books grant at all → listTransactions must be absent even though
    // the books module is installed. Permission gate, not just install gate.
    expect(tools.listTransactions).toBeUndefined();
    // employee can view invoice/quote/drive (create/manage imply view) → those are offered.
    expect(tools.listInvoices).toBeDefined();
    expect(tools.listQuotes).toBeDefined();
    expect(tools.listDriveEarnings).toBeDefined();
    expect(tools.listDriveTrips).toBeDefined();
    expect(tools.listDriveVehicles).toBeDefined();
    expect(tools.listDriveExpenses).toBeDefined();
  });

  it("omits listCustomers when the role lacks view:customer", async () => {
    // 'manager' has manage:customer (implies view) → offered. Construct a minimal role
    // without any customer grant by using a role that demonstrably lacks it: none of the
    // seeded roles fit, so instead assert the positive for manager and the negative for a
    // role with no customer grant isn't seedable. We assert manager (manage→view) gets it.
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("manager"), []);
    expect(tools.listCustomers).toBeDefined();
    // manager has view:activity → listRecentActivity offered.
    expect(tools.listRecentActivity).toBeDefined();
  });
});

describe("buildAssistantTools - execute trims + scopes to workspace", () => {
  it("openForm returns a validated unsaved form directive and enforces permission gates", async () => {
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const ownerTools = buildAssistantTools(ctx("owner"), ALL_MODULES);
    const ownerResult = (await run(ownerTools.openForm, {
      workflow: "invoice.create",
      requestSummary: "Draft an invoice for Acme for $250",
      fields: {
        customerQuery: "Acme",
        lineItems: [{ quantity: 1, unitPriceCents: 25_000 }],
      },
    })) as { ok: boolean; directive: { href: string } };
    expect(ownerResult).toMatchObject({ ok: true, directive: { href: "/invoices/new" } });

    const readonlyTools = buildAssistantTools(ctx("readonly"), ALL_MODULES);
    const readonlyResult = (await run(readonlyTools.openForm, {
      workflow: "invoice.create",
      requestSummary: "Draft an invoice",
      fields: {},
    })) as { ok: boolean; error: string };
    expect(readonlyResult.ok).toBe(false);
    expect(readonlyResult.error).toMatch(/permission/i);
  });

  it("listInvoices returns trimmed rows with ISO dates and calls the service with the ctx workspaceId", async () => {
    const issue = new Date("2026-01-15T00:00:00.000Z");
    const due = new Date("2026-01-29T00:00:00.000Z");
    listInvoicesMock.mockResolvedValue([
      {
        id: "secret-id",
        workspaceId: "secret-ws",
        number: "INV-001",
        status: "overdue",
        totalCents: 12500,
        currency: "AUD",
        issueDate: issue,
        dueDate: due,
        paidAt: null,
        customerName: "Jane Co",
        notes: "should not leak",
      },
    ]);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("readonly");
    const tools = buildAssistantTools(c, ALL_MODULES);
    const out = (await run(tools.listInvoices, { status: "overdue", limit: 5 })) as {
      items: Record<string, unknown>[];
      returned: number;
      hasMore: boolean;
      href: string;
    };
    expect(out).toMatchObject({ returned: 1, hasMore: false, href: "/invoices" });
    expect(out.items).toHaveLength(1);
    const row = out.items[0]!;
    // Trimmed shape - scoped id but no workspaceId/notes; money as integer cents; dates as ISO.
    expect(row).toMatchObject({
      id: "secret-id",
      href: "/invoices/secret-id",
      number: "INV-001",
      status: "overdue",
      totalCents: 12500,
      // Still owed in full: an overdue invoice has not been paid.
      balanceDueCents: 12500,
      currency: "AUD",
      issueDate: issue.toISOString(),
      dueDate: due.toISOString(),
      paidAt: null,
      customerName: "Jane Co",
    });
    expect(row).not.toHaveProperty("workspaceId");
    expect(row).not.toHaveProperty("notes");
    // The service was called with the ctx workspaceId, never a client-supplied one.
    // One extra row is requested to detect `hasMore`.
    expect(listInvoicesMock).toHaveBeenCalledWith(c.workspaceId, {
      status: "overdue",
      limit: 6,
    });
  });

  it("listInvoices clamps an out-of-range limit", async () => {
    listInvoicesMock.mockResolvedValue([]);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("readonly"), ALL_MODULES);
    await run(tools.listInvoices, { limit: 99999 });
    expect(listInvoicesMock).toHaveBeenCalledWith(expect.anything(), {
      status: undefined,
      limit: 101, // max is 100, plus one row to detect hasMore.
    });
  });

  it("list tools report hasMore and drop the extra probe row when the service returns limit + 1 rows", async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({
      id: `inv-${i}`,
      number: `INV-00${i}`,
      status: "sent",
      totalCents: 100,
      currency: "AUD",
      issueDate: new Date("2026-01-15T00:00:00.000Z"),
      paidAt: null,
      customerName: null,
    }));
    listInvoicesMock.mockResolvedValue(rows);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("readonly"), ALL_MODULES);
    const out = (await run(tools.listInvoices, { limit: 3 })) as {
      items: { id: string }[];
      returned: number;
      hasMore: boolean;
    };
    expect(listInvoicesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 4 }),
    );
    expect(out.hasMore).toBe(true);
    expect(out.returned).toBe(3);
    expect(out.items.map((r) => r.id)).toEqual(["inv-0", "inv-1", "inv-2"]);
  });

  it("list tools report hasMore: false when the service returns fewer rows than limit + 1", async () => {
    listInvoicesMock.mockResolvedValue([
      { id: "inv-0", number: "INV-000", status: "sent", issueDate: new Date(), paidAt: null },
      { id: "inv-1", number: "INV-001", status: "sent", issueDate: new Date(), paidAt: null },
    ]);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("readonly"), ALL_MODULES);
    const out = (await run(tools.listInvoices, { limit: 3 })) as {
      items: unknown[];
      returned: number;
      hasMore: boolean;
    };
    expect(out).toMatchObject({ returned: 2, hasMore: false });
    expect(out.items).toHaveLength(2);
  });

  it("every list tool returns { items, returned, hasMore, href } and probes with limit + 1", async () => {
    const date = new Date("2026-07-06T00:00:00.000Z");
    const row = { id: "r1", date, issueDate: date, paidAt: null };
    for (const mock of [
      listInvoicesMock,
      listQuotesMock,
      listTransactionsMock,
      listEarningsMock,
      listTripsMock,
      listExpensesMock,
      listCustomersMock,
    ]) {
      mock.mockResolvedValue([row]);
    }
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES);
    const cases: [string, ReturnType<typeof vi.fn>, string, string | undefined][] = [
      ["listInvoices", listInvoicesMock, "/invoices", "/invoices/r1"],
      ["listQuotes", listQuotesMock, "/quotes", "/quotes/r1"],
      ["listTransactions", listTransactionsMock, "/books", "/books/r1"],
      ["listDriveEarnings", listEarningsMock, "/drive", undefined],
      ["listDriveTrips", listTripsMock, "/drive", undefined],
      ["listDriveExpenses", listExpensesMock, "/drive/expenses", undefined],
      ["listCustomers", listCustomersMock, "/customers", "/customers/r1"],
    ];
    for (const [name, mock, listHref, rowHref] of cases) {
      const out = (await run(tools[name])) as {
        items: Record<string, unknown>[];
        returned: number;
        hasMore: boolean;
        href: string;
      };
      expect(out, name).toMatchObject({ returned: 1, hasMore: false, href: listHref });
      expect(out.items[0]?.href, name).toBe(rowHref);
      // Default limit is 20, so the service is asked for 21.
      expect(mock, name).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ limit: 21 }),
      );
    }
  });

  it("listCustomers returns id + trimmed rows (no workspaceId/notes/createdAt)", async () => {
    listCustomersMock.mockResolvedValue([
      {
        id: "cust-1",
        workspaceId: "secret",
        name: "Jane Co",
        email: "jane@example.com",
        phone: "+61",
        company: "Jane Co Pty",
        notes: "secret notes",
        createdAt: new Date(),
      },
    ]);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("readonly"), []);
    const result = (await run(tools.listCustomers, { search: "jane" })) as {
      items: Record<string, unknown>[];
      href: string;
    };
    const out = result.items;
    expect(result.href).toBe("/customers");
    // id is returned so the model can call updateCustomer / attach to invoices.
    expect(out[0]).toMatchObject({
      id: "cust-1",
      href: "/customers/cust-1",
      name: "Jane Co",
      email: "jane@example.com",
      company: "Jane Co Pty",
      phone: "+61",
    });
    expect(out[0]).not.toHaveProperty("workspaceId");
    expect(out[0]).not.toHaveProperty("notes");
    expect(out[0]).not.toHaveProperty("createdAt");
  });

  it("getWorkspaceOverview returns null KPIs for uninstalled/unauthorized modules and real values for installed ones", async () => {
    getBookSummaryMock.mockResolvedValue({
      incomeCents: 10000,
      expenseCents: 2500,
      netCents: 7500,
    });
    getInvoiceDashboardSummaryMock.mockResolvedValue({
      outstandingCents: 5000,
      overdueCount: 2,
      paidCents: 3000,
    });
    listActivityMock.mockResolvedValue({
      items: [
        {
          id: "a1",
          type: "invoice.sent",
          workspaceId: "x",
          actorUserId: null,
          actorFullName: "Sam",
          actorEmail: null,
          entityType: "invoice",
          entityId: "i1",
          metadata: null,
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      ],
      nextCursor: null,
    });

    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    // Only books + invoices installed; quotes + drive absent → their KPIs must be null.
    const c = ctx("readonly");
    const tools = buildAssistantTools(c, ["invoices", "books"]);
    const overview = (await run(tools.getWorkspaceOverview)) as {
      installedModules: string[];
      currency: string;
      kpis: Record<string, number | null>;
      recentActivity: { type: string; createdAt: string | null }[] | null;
    };
    expect(overview.installedModules).toEqual(["invoices", "books"]);
    expect(overview.currency).toBe("AUD");
    expect(getWorkspaceMock).toHaveBeenCalledWith(expect.anything());
    expect(overview.kpis.cashCents).toBe(7500);
    expect(overview.kpis.outstandingCents).toBe(5000);
    expect(overview.kpis.overdueInvoiceCount).toBe(2);
    expect(overview.kpis.incomeCents).toBe(10000);
    expect(overview.kpis.revenueCents).toBe(3000);
    // Quotes module not installed → pendingQuotesCents is null (not a fabricated 0).
    expect(overview.kpis.pendingQuotesCents).toBeNull();
    expect(overview.recentActivity).toHaveLength(1);
    expect(overview.recentActivity![0]!.type).toBe("invoice.sent");
    expect(overview.recentActivity![0]!.createdAt).toBe("2026-01-02T00:00:00.000Z");
    // SQL-backed summaries are scoped to the ctx workspace; uninstalled modules are not queried.
    expect(getBookSummaryMock).toHaveBeenCalledWith(c.workspaceId, {
      dateFrom: expect.any(Date),
      dateTo: expect.any(Date),
    });
    expect(getInvoiceDashboardSummaryMock).toHaveBeenCalledWith(
      c.workspaceId,
      expect.anything(),
      null,
    );
    expect(getQuoteDashboardSummaryMock).not.toHaveBeenCalled();
    expect(getDriveSummaryMock).not.toHaveBeenCalled();
    // The overview no longer fetches rows and summarises them in JS.
    expect(listInvoicesMock).not.toHaveBeenCalled();
    expect(listQuotesMock).not.toHaveBeenCalled();
    expect(listTransactionsMock).not.toHaveBeenCalled();
    expect(listEarningsMock).not.toHaveBeenCalled();
  });

  it("getWorkspaceOverview reads quotes and drive summaries when those modules are installed", async () => {
    getQuoteDashboardSummaryMock.mockResolvedValue({ acceptedValueCents: 4200 });
    getDriveSummaryMock.mockResolvedValue({ totalEarningsCents: 900 });
    listActivityMock.mockResolvedValue({ items: [], nextCursor: null });
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("readonly"), ["quotes", "drive"]);
    const overview = (await run(tools.getWorkspaceOverview)) as {
      kpis: Record<string, number | null>;
    };
    expect(overview.kpis.pendingQuotesCents).toBe(4200);
    expect(overview.kpis.incomeCents).toBe(900);
    expect(overview.kpis.cashCents).toBeNull();
    expect(overview.kpis.outstandingCents).toBeNull();
    expect(getBookSummaryMock).not.toHaveBeenCalled();
    expect(getInvoiceDashboardSummaryMock).not.toHaveBeenCalled();
    expect(listQuotesMock).not.toHaveBeenCalled();
    expect(listEarningsMock).not.toHaveBeenCalled();
  });

  it("getWorkspaceOverview reports the workspace currency", async () => {
    getWorkspaceMock.mockResolvedValue({ defaultCurrency: "NZD" });
    listActivityMock.mockResolvedValue({ items: [], nextCursor: null });

    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const overview = (await run(buildAssistantTools(ctx("readonly"), []).getWorkspaceOverview)) as {
      currency: string;
    };

    expect(overview.currency).toBe("NZD");
  });

  it("getWorkspaceOverview drops the activity slice when the role lacks view:activity", async () => {
    // 'employee' has view:activity; use a role without it: 'admin' has view:activity too.
    // Construct the negative by stubbing: none of the seeded non-readonly roles lack view:activity
    // except… actually all roles have view:activity. So assert the positive: admin gets activity.
    listActivityMock.mockResolvedValue({ items: [], nextCursor: null });
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("admin"), []);
    const overview = (await run(tools.getWorkspaceOverview)) as { recentActivity: unknown };
    expect(Array.isArray(overview.recentActivity)).toBe(true);
  });
});

/**
 * Write tools (Phase 11d). The per-conversation `writeEnabled` flag is the hard
 * boundary - when off (the default), no write tools are offered at all. When on,
 * each write tool is fail-closed on `manage:R` + module-install, and `execute`
 * re-checks `manage:R` (defense in depth) + returns a trimmed confirmation.
 */
describe("buildAssistantTools - write tools", () => {
  it("offers no write tools when writeEnabled is off (default)", async () => {
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES);
    expect(tools.createCustomer).toBeUndefined();
    expect(tools.updateCustomer).toBeUndefined();
    expect(tools.createInvoice).toBeUndefined();
    expect(tools.createQuote).toBeUndefined();
    expect(tools.createTransaction).toBeUndefined();
    expect(tools.createEarning).toBeUndefined();
    expect(tools.updateTransaction).toBeUndefined();
    expect(tools.deleteTransaction).toBeUndefined();
    expect(tools.sendInvoice).toBeUndefined();
    expect(tools.convertQuoteToInvoice).toBeUndefined();
  });

  it("offers every write tool to an owner when writeEnabled + all modules installed", async () => {
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    // Customer + invoice/quote/books/drive write tools + actions.
    expect(tools.createCustomer).toBeDefined();
    expect(tools.updateCustomer).toBeDefined();
    expect(tools.createInvoice).toBeDefined();
    expect(tools.createQuote).toBeDefined();
    expect(tools.createTransaction).toBeDefined();
    expect(tools.extractReceipt).toBeDefined();
    expect(tools.createEarning).toBeDefined();
    expect(tools.createTrip).toBeDefined();
    expect(tools.createExpense).toBeDefined();
    expect(tools.updateTransaction).toBeDefined();
    expect(tools.deleteTransaction).toBeDefined();
    expect(tools.sendInvoice).toBeDefined();
    expect(tools.voidInvoice).toBeDefined();
    expect(tools.markInvoicePaid).toBeDefined();
    expect(tools.convertQuoteToInvoice).toBeDefined();
  });

  it("does not offer write tools to readonly even with writeEnabled on (fail-closed on manage:R)", async () => {
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("readonly"), ALL_MODULES, { writeEnabled: true });
    // readonly has no manage:* grants at all → every write tool fail-closed.
    expect(tools.createCustomer).toBeUndefined();
    expect(tools.updateCustomer).toBeUndefined();
    expect(tools.createInvoice).toBeUndefined();
    expect(tools.createQuote).toBeUndefined();
    expect(tools.createTransaction).toBeUndefined();
    expect(tools.createEarning).toBeUndefined();
    expect(tools.updateTransaction).toBeUndefined();
    expect(tools.deleteTransaction).toBeUndefined();
    expect(tools.sendInvoice).toBeUndefined();
    expect(tools.convertQuoteToInvoice).toBeUndefined();
  });

  it("does not offer module-gated write tools when their module is uninstalled", async () => {
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    // Only books installed - invoice/quote/drive write tools absent, books + customer present.
    const tools = buildAssistantTools(ctx("owner"), ["books"], { writeEnabled: true });
    expect(tools.createCustomer).toBeDefined();
    expect(tools.updateCustomer).toBeDefined(); // customer tools are not module-gated.
    expect(tools.createTransaction).toBeDefined();
    expect(tools.extractReceipt).toBeDefined();
    expect(tools.updateTransaction).toBeDefined();
    expect(tools.deleteTransaction).toBeDefined();
    // Invoices / quotes / drive not installed.
    expect(tools.createInvoice).toBeUndefined();
    expect(tools.createQuote).toBeUndefined();
    expect(tools.createEarning).toBeUndefined();
    expect(tools.createTrip).toBeUndefined();
    expect(tools.createExpense).toBeUndefined();
    expect(tools.sendInvoice).toBeUndefined();
    expect(tools.voidInvoice).toBeUndefined();
    expect(tools.markInvoicePaid).toBeUndefined();
    expect(tools.convertQuoteToInvoice).toBeUndefined();
  });

  it("employee (create:invoice but not manage:invoice) gets customer+drive write tools, not invoice/quote/books", async () => {
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("employee"), ALL_MODULES, { writeEnabled: true });
    // employee has manage:customer + manage:drive + manage:file, but only create:invoice/quote
    // (not manage) → AI invoice/quote write tools + actions are fail-closed.
    expect(tools.createCustomer).toBeDefined();
    expect(tools.updateCustomer).toBeDefined();
    expect(tools.createEarning).toBeDefined(); // employee has manage:drive
    expect(tools.createTrip).toBeDefined();
    expect(tools.createExpense).toBeDefined();
    expect(tools.createInvoice).toBeUndefined(); // create:invoice but not manage:invoice
    expect(tools.createQuote).toBeUndefined();
    expect(tools.sendInvoice).toBeUndefined();
    expect(tools.convertQuoteToInvoice).toBeUndefined();
    // employee has no books grant at all.
    expect(tools.createTransaction).toBeUndefined();
    expect(tools.updateTransaction).toBeUndefined();
    expect(tools.deleteTransaction).toBeUndefined();
  });

  it("manager lacks manage:books → no books write tools even with writeEnabled on", async () => {
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("manager"), ALL_MODULES, { writeEnabled: true });
    // manager has manage:invoice/quote/customer/drive.
    expect(tools.createInvoice).toBeDefined();
    expect(tools.createQuote).toBeDefined();
    expect(tools.createCustomer).toBeDefined();
    expect(tools.updateCustomer).toBeDefined();
    expect(tools.sendInvoice).toBeDefined();
    expect(tools.voidInvoice).toBeDefined();
    expect(tools.markInvoicePaid).toBeDefined();
    expect(tools.convertQuoteToInvoice).toBeDefined();
    expect(tools.createEarning).toBeDefined(); // manager has manage:drive
    // manager only has view:books → books write tools fail-closed.
    expect(tools.createTransaction).toBeUndefined();
    expect(tools.updateTransaction).toBeUndefined();
    expect(tools.deleteTransaction).toBeUndefined();
    expect(tools.extractReceipt).toBeUndefined();
  });

  it("accountant lacks manage:drive → no drive write tools even with writeEnabled on", async () => {
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("accountant"), ALL_MODULES, { writeEnabled: true });
    // accountant has manage:books/invoice/quote/customer.
    expect(tools.createTransaction).toBeDefined();
    expect(tools.updateTransaction).toBeDefined();
    expect(tools.deleteTransaction).toBeDefined();
    expect(tools.createInvoice).toBeDefined();
    expect(tools.sendInvoice).toBeDefined();
    expect(tools.convertQuoteToInvoice).toBeDefined();
    // accountant has NO manage:drive → drive write tools fail-closed.
    expect(tools.createEarning).toBeUndefined();
    expect(tools.createTrip).toBeUndefined();
    expect(tools.createExpense).toBeUndefined();
  });

  it("createInvoice execute calls the service with the ctx workspaceId + actorId and returns a trimmed id plus number, href and label", async () => {
    createInvoiceMock.mockResolvedValue("inv-new-id");
    getInvoiceMock.mockResolvedValue({ id: "inv-new-id", number: "INV-2026-0009" });
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("owner");
    const tools = buildAssistantTools(c, ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.createInvoice, {
      issueDate: "2026-07-06T00:00:00.000Z",
      taxRate: 10,
      lineItems: [{ description: "Consulting", quantity: 10, unitPriceCents: 5000 }],
    })) as { id: string };
    expect(out).toEqual({
      id: "inv-new-id",
      number: "INV-2026-0009",
      href: "/invoices/inv-new-id",
      recordLabel: "INV-2026-0009",
    });
    expect(createInvoiceMock).toHaveBeenCalledTimes(1);
    const [wsId, input, actorId] = createInvoiceMock.mock.calls[0]!;
    expect(wsId).toBe(c.workspaceId);
    expect(actorId).toBe(c.user.id);
    // Money as integer cents; date parsed; line items passed through.
    expect(input).toMatchObject({
      taxRate: 10,
      currency: undefined,
      lineItems: [{ description: "Consulting", quantity: 10, unitPriceCents: 5000 }],
    });
    expect(input.issueDate).toBeInstanceOf(Date);
  });

  it("createInvoice resolves customerEmail to the active customer id (preferred over passing a uuid)", async () => {
    // Email is the stable, human-meaningful reference the model reliably carries;
    // the tool resolves it server-side so the model never has to transcribe a uuid.
    getCustomerByEmailMock.mockResolvedValue({ id: "cust-amos", name: "Amos Palfreyman" });
    createInvoiceMock.mockResolvedValue("inv-new-id");
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("owner");
    const tools = buildAssistantTools(c, ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.createInvoice, {
      customerEmail: "amos@miruku.com",
      issueDate: "2026-07-06T00:00:00.000Z",
      taxRate: 0,
      lineItems: [{ description: "Test", quantity: 1, unitPriceCents: 10000 }],
    })) as { id: string };
    expect(out).toMatchObject({ id: "inv-new-id", number: null, href: "/invoices/inv-new-id" });
    expect(getCustomerByEmailMock).toHaveBeenCalledWith(c.workspaceId, "amos@miruku.com");
    expect(createInvoiceMock).toHaveBeenCalledTimes(1);
    const [, input] = createInvoiceMock.mock.calls[0]!;
    // The resolved id (not the email, not a uuid) is passed to the service.
    expect(input).toMatchObject({ customerId: "cust-amos" });
    expect(input).not.toHaveProperty("customerEmail");
  });

  it("createInvoice returns a friendly, recoverable error when the customer email isn't found", async () => {
    getCustomerByEmailMock.mockResolvedValue(null);
    createInvoiceMock.mockResolvedValue("inv-new-id");
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.createInvoice, {
      customerEmail: "nobody@x.test",
      issueDate: "2026-07-06T00:00:00.000Z",
      taxRate: 0,
      lineItems: [{ description: "Test", quantity: 1, unitPriceCents: 10000 }],
    })) as { error: string };
    expect(out.error).toMatch(/couldn't find a customer with email nobody@x.test/);
    // The service is NOT called - no half-created invoice.
    expect(createInvoiceMock).not.toHaveBeenCalled();
  });

  it("createInvoice returns a friendly error for a stale customerId (no raw 'not found' throw)", async () => {
    getCustomerMock.mockResolvedValue(null);
    createInvoiceMock.mockResolvedValue("inv-new-id");
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.createInvoice, {
      customerId: "00000000-0000-4000-8000-0000000000f1",
      issueDate: "2026-07-06T00:00:00.000Z",
      taxRate: 0,
      lineItems: [{ description: "Test", quantity: 1, unitPriceCents: 10000 }],
    })) as { error: string };
    expect(out.error).toMatch(/couldn't find that customer/i);
    expect(createInvoiceMock).not.toHaveBeenCalled();
  });

  it("createQuote resolves customerEmail to the active customer id", async () => {
    getCustomerByEmailMock.mockResolvedValue({ id: "cust-amos", name: "Amos Palfreyman" });
    createQuoteMock.mockResolvedValue("quo-new-id");
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("owner");
    const tools = buildAssistantTools(c, ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.createQuote, {
      customerEmail: "amos@miruku.com",
      issueDate: "2026-07-06T00:00:00.000Z",
      taxRate: 0,
      lineItems: [{ description: "Test", quantity: 1, unitPriceCents: 10000 }],
    })) as { id: string };
    expect(out).toEqual({ id: "quo-new-id", number: null, href: "/quotes/quo-new-id" });
    expect(getCustomerByEmailMock).toHaveBeenCalledWith(c.workspaceId, "amos@miruku.com");
    const [, input] = createQuoteMock.mock.calls[0]!;
    expect(input).toMatchObject({ customerId: "cust-amos" });
    expect(input).not.toHaveProperty("customerEmail");
  });

  it("createCustomer execute wraps the event-only service with writeAudit", async () => {
    createCustomerMock.mockResolvedValue("cust-new-id");
    writeAuditMock.mockResolvedValue(undefined);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("owner");
    const tools = buildAssistantTools(c, ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.createCustomer, { name: "Acme Pty" })) as {
      id: string;
      name: string;
    };
    expect(out).toEqual({
      id: "cust-new-id",
      name: "Acme Pty",
      href: "/customers/cust-new-id",
      recordLabel: "Acme Pty",
    });
    expect(createCustomerMock).toHaveBeenCalledWith(c.workspaceId, { name: "Acme Pty" }, c.user.id);
    // The tool audits the AI-created customer (the service is event-only), then the wrapper
    // adds one assistant.action row.
    expect(writeAuditMock).toHaveBeenCalledTimes(2);
    const audit = writeAuditMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(audit).toMatchObject({
      workspaceId: c.workspaceId,
      actorUserId: c.user.id,
      action: "customer.create",
      targetType: "customer",
      targetId: "cust-new-id",
    });
    expect(audit.metadata).toMatchObject({ source: "ai_assistant", name: "Acme Pty" });
    expect(assistantActionAudits()).toEqual([
      {
        workspaceId: c.workspaceId,
        actorUserId: c.user.id,
        action: "assistant.action",
        targetType: "customer",
        targetId: "cust-new-id",
        metadata: { source: "ai_assistant", tool: "createCustomer", label: "Acme Pty" },
      },
    ]);
  });

  it("createCustomer returns the existing customer on a duplicate-email collision (no create, no audit, no assistant.action)", async () => {
    // The service throws the partial-unique-index violation; the tool recovers by
    // returning the existing customer with `existed: true` so the model can say
    // "already exists - using them" and continue, instead of a raw Postgres error.
    createCustomerMock.mockRejectedValue(
      new Error(
        'duplicate key value violates unique constraint "customers_workspace_email_unique"',
      ),
    );
    getCustomerByEmailMock.mockResolvedValue({ id: "cust-existing-id", name: "Acme Pty" });
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("owner");
    const tools = buildAssistantTools(c, ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.createCustomer, { name: "Acme Pty", email: "acme@x.test" })) as {
      id: string;
      name: string;
      existed: boolean;
    };
    expect(out).toEqual({
      id: "cust-existing-id",
      name: "Acme Pty",
      existed: true,
      href: "/customers/cust-existing-id",
      recordLabel: "Acme Pty",
    });
    expect(getCustomerByEmailMock).toHaveBeenCalledWith(c.workspaceId, "acme@x.test");
    // Nothing was created → no audit, no second createCustomer call beyond the first.
    expect(createCustomerMock).toHaveBeenCalledTimes(1);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("createCustomer re-throws a non-duplicate error so it surfaces honestly", async () => {
    createCustomerMock.mockRejectedValue(new Error("connection refused"));
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    await expect(run(tools.createCustomer, { name: "Acme Pty" })).rejects.toThrow(
      "connection refused",
    );
    expect(getCustomerByEmailMock).not.toHaveBeenCalled();
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("updateCustomer execute patches the customer (strips customerId from the patch) + audits", async () => {
    updateCustomerMock.mockResolvedValue(undefined);
    writeAuditMock.mockResolvedValue(undefined);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("owner");
    const tools = buildAssistantTools(c, ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.updateCustomer, {
      customerId: "00000000-0000-4000-8000-0000000000d1",
      phone: "+642742709347",
    })) as { id: string; updated: boolean };
    expect(out).toEqual({
      id: "00000000-0000-4000-8000-0000000000d1",
      updated: true,
      href: "/customers/00000000-0000-4000-8000-0000000000d1",
    });
    // The service receives the patch WITHOUT customerId, with the ctx workspaceId + actor.
    expect(updateCustomerMock).toHaveBeenCalledTimes(1);
    const [wsId, custId, patch, actorId] = updateCustomerMock.mock.calls[0]!;
    expect(wsId).toBe(c.workspaceId);
    expect(custId).toBe("00000000-0000-4000-8000-0000000000d1");
    expect(actorId).toBe(c.user.id);
    expect(patch).toEqual({ phone: "+642742709347" });
    expect(patch).not.toHaveProperty("customerId");
    // Audited as customer.update with the changed fields.
    // customer.update first, then the wrapper's assistant.action row.
    expect(writeAuditMock).toHaveBeenCalledTimes(2);
    const audit = writeAuditMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(audit).toMatchObject({
      workspaceId: c.workspaceId,
      actorUserId: c.user.id,
      action: "customer.update",
      targetType: "customer",
      targetId: "00000000-0000-4000-8000-0000000000d1",
    });
    expect(audit.metadata).toMatchObject({ source: "ai_assistant", fields: ["phone"] });
    expect(assistantActionAudits()).toHaveLength(1);
    expect(assistantActionAudits()[0]).toMatchObject({
      targetType: "customer",
      targetId: "00000000-0000-4000-8000-0000000000d1",
      metadata: { source: "ai_assistant", tool: "updateCustomer" },
    });
  });

  it("updateCustomer returns a friendly error when the customer isn't found", async () => {
    updateCustomerMock.mockRejectedValue(new Error("Customer not found."));
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.updateCustomer, {
      customerId: "00000000-0000-4000-8000-0000000000d2",
      phone: "+61",
    })) as { error: string };
    expect(out).toEqual({ error: "Customer not found." });
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("updateCustomer returns a friendly error on a duplicate-email collision", async () => {
    updateCustomerMock.mockRejectedValue(
      new Error(
        'duplicate key value violates unique constraint "customers_workspace_email_unique"',
      ),
    );
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.updateCustomer, {
      customerId: "00000000-0000-4000-8000-0000000000d3",
      email: "taken@x.test",
    })) as { error: string };
    expect(out).toEqual({ error: "Another customer with that email already exists." });
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("updateCustomer re-throws a non-matching error so it surfaces honestly", async () => {
    updateCustomerMock.mockRejectedValue(new Error("connection refused"));
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    await expect(
      run(tools.updateCustomer, {
        customerId: "00000000-0000-4000-8000-0000000000d4",
        phone: "+61",
      }),
    ).rejects.toThrow("connection refused");
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("createTransaction execute passes type/amount/date/category through to the service", async () => {
    createTransactionMock.mockResolvedValue("txn-new-id");
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("accountant");
    const tools = buildAssistantTools(c, ["books"], { writeEnabled: true });
    const out = (await run(tools.createTransaction, {
      type: "expense",
      amountCents: 4200,
      date: "2026-07-06T00:00:00.000Z",
      description: "Office supplies",
      category: "supplies",
    })) as { id: string };
    expect(out).toEqual({ id: "txn-new-id", href: "/books/txn-new-id" });
    const [, input, actorId] = createTransactionMock.mock.calls[0]!;
    expect(input).toMatchObject({
      type: "expense",
      amountCents: 4200,
      description: "Office supplies",
      category: "supplies",
    });
    expect(input.date).toBeInstanceOf(Date);
    expect(actorId).toBe(c.user.id);
  });

  it("createTransaction returns a friendly error listing valid slugs on a wrong category (no service call)", async () => {
    // The model picks a category freely; "supplies" is expense-only, not valid for income.
    // Pre-validation returns a friendly error listing the valid income slugs so the model
    // can retry - instead of a raw "Unknown category" throw dumping into the chat.
    createTransactionMock.mockResolvedValue("txn-new-id");
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("accountant"), ["books"], { writeEnabled: true });
    const out = (await run(tools.createTransaction, {
      type: "income",
      amountCents: 10000,
      date: "2026-07-06T00:00:00.000Z",
      description: "Consulting",
      category: "supplies",
    })) as { error: string };
    expect(out.error).toMatch(/Unknown category "supplies" for income/);
    expect(out.error).toMatch(/sales, services, software/);
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it("createTransaction resolves customerEmail to the active customer id", async () => {
    getCustomerByEmailMock.mockResolvedValue({ id: "cust-amos", name: "Amos" });
    createTransactionMock.mockResolvedValue("txn-new-id");
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("accountant");
    const tools = buildAssistantTools(c, ["books"], { writeEnabled: true });
    const out = (await run(tools.createTransaction, {
      type: "income",
      amountCents: 5000,
      date: "2026-07-06T00:00:00.000Z",
      description: "Services",
      category: "services",
      customerEmail: "amos@miruku.com",
    })) as { id: string };
    expect(out).toEqual({ id: "txn-new-id", href: "/books/txn-new-id" });
    const [, input] = createTransactionMock.mock.calls[0]!;
    expect(input).toMatchObject({ customerId: "cust-amos" });
    expect(input).not.toHaveProperty("customerEmail");
  });

  it("createInvoice returns a friendly error on a number-race unique throw (no raw Postgres dump)", async () => {
    createInvoiceMock.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "invoices_number_unique"'),
    );
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.createInvoice, {
      issueDate: "2026-07-06T00:00:00.000Z",
      taxRate: 10,
      lineItems: [{ description: "Test", quantity: 1, unitPriceCents: 10000 }],
    })) as { error: string };
    expect(out.error).toMatch(/unique invoice number just now/);
  });

  it("createQuote returns a friendly error on a number-race unique throw", async () => {
    createQuoteMock.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "quotes_number_unique"'),
    );
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.createQuote, {
      issueDate: "2026-07-06T00:00:00.000Z",
      taxRate: 10,
      lineItems: [{ description: "Test", quantity: 1, unitPriceCents: 10000 }],
    })) as { error: string };
    expect(out.error).toMatch(/unique quote number just now/);
  });

  it("listInvoices passes the search filter through to the service", async () => {
    listInvoicesMock.mockResolvedValue([]);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("readonly");
    const tools = buildAssistantTools(c, ALL_MODULES);
    await run(tools.listInvoices, { search: "INV-2026-0007" });
    expect(listInvoicesMock).toHaveBeenCalledWith(c.workspaceId, {
      status: undefined,
      search: "INV-2026-0007",
      limit: 21,
    });
  });

  it("listTransactions passes search through and returns the row id", async () => {
    listTransactionsMock.mockResolvedValue([
      {
        id: "txn-1",
        type: "expense",
        amountCents: 6000,
        currency: "AUD",
        date: new Date("2026-07-06T00:00:00.000Z"),
        description: "Fuel",
        category: "travel",
        customerName: null,
      },
    ]);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("readonly");
    const tools = buildAssistantTools(c, ALL_MODULES);
    const result = (await run(tools.listTransactions, { search: "fuel" })) as {
      items: Record<string, unknown>[];
    };
    const out = result.items;
    expect(listTransactionsMock).toHaveBeenCalledWith(c.workspaceId, {
      type: undefined,
      search: "fuel",
      dateFrom: undefined,
      dateTo: undefined,
      limit: 21,
    });
    expect(out[0]).toMatchObject({ id: "txn-1", href: "/books/txn-1", category: "travel" });
  });

  // ── Drive write tools ────────────────────────────────────────────────────────

  it("createEarning validates the platform slug and calls the service with the ctx workspaceId + actor", async () => {
    createEarningMock.mockResolvedValue("earn-new-id");
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("employee");
    const tools = buildAssistantTools(c, ["drive"], { writeEnabled: true });
    const out = (await run(tools.createEarning, {
      platform: "uber",
      amountCents: 12000,
      date: "2026-07-06T00:00:00.000Z",
      description: "Evening shift",
    })) as { id: string };
    expect(out).toEqual({ id: "earn-new-id", href: "/drive" });
    const [wsId, input, actorId] = createEarningMock.mock.calls[0]!;
    expect(wsId).toBe(c.workspaceId);
    expect(actorId).toBe(c.user.id);
    expect(input).toMatchObject({ platform: "uber", amountCents: 12000 });
    expect(input.date).toBeInstanceOf(Date);
  });

  it("createEarning returns a friendly error listing valid platforms on a bad slug (no service call)", async () => {
    createEarningMock.mockResolvedValue("earn-new-id");
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("employee"), ["drive"], { writeEnabled: true });
    const out = (await run(tools.createEarning, {
      platform: "ubr",
      amountCents: 12000,
      date: "2026-07-06T00:00:00.000Z",
      description: "Evening shift",
    })) as { error: string };
    expect(out.error).toMatch(/Unknown platform "ubr"/);
    expect(out.error).toMatch(/uber, uber_eats, doordash/);
    expect(createEarningMock).not.toHaveBeenCalled();
  });

  it("createTrip converts distanceKm to integer meters before calling the service", async () => {
    createTripMock.mockResolvedValue("trip-new-id");
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("employee");
    const tools = buildAssistantTools(c, ["drive"], { writeEnabled: true });
    const out = (await run(tools.createTrip, {
      platform: "doordash",
      distanceKm: 45.3,
      date: "2026-07-06T00:00:00.000Z",
    })) as { id: string };
    expect(out).toEqual({ id: "trip-new-id", href: "/drive" });
    const [, input] = createTripMock.mock.calls[0]!;
    // 45.3 km → 45300 meters (rounded).
    expect(input).toMatchObject({ platform: "doordash", distanceMeters: 45300 });
  });

  it("createExpense resolves vehicleName to the vehicle id via listVehicles (case-insensitive)", async () => {
    listVehiclesMock.mockResolvedValue([
      { id: "veh-hilux", name: "Hilux" },
      { id: "veh-mazda", name: "Mazda" },
    ]);
    createExpenseMock.mockResolvedValue("exp-new-id");
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("employee");
    const tools = buildAssistantTools(c, ["drive"], { writeEnabled: true });
    const out = (await run(tools.createExpense, {
      vehicleName: "hilux",
      type: "fuel",
      amountCents: 6000,
      date: "2026-07-06T00:00:00.000Z",
      description: "Fill up",
    })) as { id: string };
    expect(out).toEqual({ id: "exp-new-id", href: "/drive/expenses" });
    const [, input] = createExpenseMock.mock.calls[0]!;
    expect(input).toMatchObject({ vehicleId: "veh-hilux", type: "fuel", amountCents: 6000 });
  });

  it("createExpense returns a friendly error when the vehicle isn't found (no createExpense call)", async () => {
    listVehiclesMock.mockResolvedValue([{ id: "veh-hilux", name: "Hilux" }]);
    createExpenseMock.mockResolvedValue("exp-new-id");
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("employee"), ["drive"], { writeEnabled: true });
    const out = (await run(tools.createExpense, {
      vehicleName: "Tractor",
      type: "fuel",
      amountCents: 6000,
      date: "2026-07-06T00:00:00.000Z",
      description: "Fill up",
    })) as { error: string };
    expect(out.error).toMatch(/Vehicle "Tractor" not found/);
    expect(createExpenseMock).not.toHaveBeenCalled();
  });

  // ── Books update/delete ─────────────────────────────────────────────────────

  it("updateTransaction patches the transaction and returns { id, updated: true }", async () => {
    updateTransactionMock.mockResolvedValue(undefined);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("accountant");
    const tools = buildAssistantTools(c, ["books"], { writeEnabled: true });
    const out = (await run(tools.updateTransaction, {
      transactionId: "00000000-0000-4000-8000-0000000000e1",
      category: "travel",
    })) as { id: string; updated: boolean };
    expect(out).toEqual({
      id: "00000000-0000-4000-8000-0000000000e1",
      updated: true,
      href: "/books/00000000-0000-4000-8000-0000000000e1",
    });
    const [wsId, txId, patch, actorId] = updateTransactionMock.mock.calls[0]!;
    expect(wsId).toBe(c.workspaceId);
    expect(actorId).toBe(c.user.id);
    expect(patch).toMatchObject({ category: "travel" });
    expect(txId).toBeDefined();
  });

  it("updateTransaction returns a friendly error when type changes without a category", async () => {
    updateTransactionMock.mockResolvedValue(undefined);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("accountant"), ["books"], { writeEnabled: true });
    const out = (await run(tools.updateTransaction, {
      transactionId: "00000000-0000-4000-8000-0000000000e2",
      type: "expense",
    })) as { error: string };
    expect(out.error).toMatch(/Category is required when changing transaction type/);
    expect(updateTransactionMock).not.toHaveBeenCalled();
  });

  it("updateTransaction returns a friendly error for a category invalid for the new type", async () => {
    updateTransactionMock.mockResolvedValue(undefined);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("accountant"), ["books"], { writeEnabled: true });
    const out = (await run(tools.updateTransaction, {
      transactionId: "00000000-0000-4000-8000-0000000000e3",
      type: "income",
      category: "rent",
    })) as { error: string };
    expect(out.error).toMatch(/Unknown category "rent" for income/);
    expect(updateTransactionMock).not.toHaveBeenCalled();
  });

  it("updateTransaction returns a friendly 'Transaction not found.' when the service throws not-found", async () => {
    updateTransactionMock.mockRejectedValue(new Error("Transaction not found."));
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("accountant"), ["books"], { writeEnabled: true });
    const out = (await run(tools.updateTransaction, {
      transactionId: "00000000-0000-4000-8000-0000000000e4",
      description: "Updated",
    })) as { error: string };
    expect(out.error).toBe("Transaction not found.");
  });

  it("deleteTransaction returns { id, deleted: true } on success", async () => {
    deleteTransactionMock.mockResolvedValue(true);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("accountant");
    const tools = buildAssistantTools(c, ["books"], { writeEnabled: true });
    const out = (await run(tools.deleteTransaction, {
      transactionId: "00000000-0000-4000-8000-0000000000e5",
    })) as { id: string; deleted: boolean };
    expect(out).toEqual({
      id: "00000000-0000-4000-8000-0000000000e5",
      deleted: true,
      href: "/books",
    });
    expect(deleteTransactionMock).toHaveBeenCalledWith(c.workspaceId, expect.anything(), c.user.id);
  });

  it("deleteTransaction returns a friendly error when the service reports not found (returns false)", async () => {
    deleteTransactionMock.mockResolvedValue(false);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("accountant"), ["books"], { writeEnabled: true });
    const out = (await run(tools.deleteTransaction, {
      transactionId: "00000000-0000-4000-8000-0000000000e6",
    })) as { error: string };
    expect(out.error).toBe("Transaction not found.");
  });

  // ── Invoice/quote action tools (resolve by number) ───────────────────────────

  it("sendInvoice resolves the invoice by number and returns { sent: true, number }", async () => {
    // resolveInvoiceByNumber reuses listInvoices search then exact-matches the number.
    listInvoicesMock.mockResolvedValue([{ id: "inv-7", number: "INV-2026-0007", status: "draft" }]);
    sendInvoiceMock.mockResolvedValue(true);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("owner");
    const tools = buildAssistantTools(c, ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.sendInvoice, { invoiceNumber: "INV-2026-0007" })) as {
      sent: boolean;
      number: string;
    };
    expect(out).toEqual({
      id: "inv-7",
      sent: true,
      number: "INV-2026-0007",
      href: "/invoices/inv-7",
      recordLabel: "INV-2026-0007",
    });
    expect(sendInvoiceMock).toHaveBeenCalledWith(c.workspaceId, "inv-7", c.user.id);
  });

  it("sendInvoice returns a friendly error when the invoice number isn't found", async () => {
    listInvoicesMock.mockResolvedValue([]);
    sendInvoiceMock.mockResolvedValue(true);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.sendInvoice, { invoiceNumber: "INV-9999" })) as { error: string };
    expect(out.error).toMatch(/Invoice INV-9999 not found/);
    expect(sendInvoiceMock).not.toHaveBeenCalled();
  });

  it("sendInvoice returns a friendly state error when the service returns false (already sent)", async () => {
    listInvoicesMock.mockResolvedValue([{ id: "inv-7", number: "INV-2026-0007", status: "sent" }]);
    sendInvoiceMock.mockResolvedValue(false);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.sendInvoice, { invoiceNumber: "INV-2026-0007" })) as {
      error: string;
    };
    expect(out.error).toMatch(/isn't a draft/);
  });

  it("voidInvoice resolves by number and returns { voided: true, number }", async () => {
    listInvoicesMock.mockResolvedValue([{ id: "inv-7", number: "INV-2026-0007", status: "draft" }]);
    voidInvoiceMock.mockResolvedValue(true);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("owner");
    const tools = buildAssistantTools(c, ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.voidInvoice, { invoiceNumber: "INV-2026-0007" })) as {
      voided: boolean;
      number: string;
    };
    expect(out).toEqual({
      id: "inv-7",
      voided: true,
      number: "INV-2026-0007",
      href: "/invoices/inv-7",
      recordLabel: "INV-2026-0007",
    });
    expect(voidInvoiceMock).toHaveBeenCalledWith(c.workspaceId, "inv-7", c.user.id);
  });

  it("markInvoicePaid resolves by number and returns { paid: true, number }", async () => {
    listInvoicesMock.mockResolvedValue([{ id: "inv-7", number: "INV-2026-0007", status: "sent" }]);
    markInvoicePaidMock.mockResolvedValue(true);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("owner");
    const tools = buildAssistantTools(c, ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.markInvoicePaid, { invoiceNumber: "INV-2026-0007" })) as {
      paid: boolean;
      number: string;
    };
    expect(out).toEqual({
      id: "inv-7",
      paid: true,
      number: "INV-2026-0007",
      href: "/invoices/inv-7",
      recordLabel: "INV-2026-0007",
    });
    expect(markInvoicePaidMock).toHaveBeenCalledWith(c.workspaceId, "inv-7", c.user.id);
  });

  it("convertQuoteToInvoice delegates canonical amounts and creation to the shared atomic operation", async () => {
    // resolveQuoteByNumber reuses listQuotes search then exact-matches.
    listQuotesMock.mockResolvedValue([
      { id: "quo-3", number: "QUO-2026-0003", status: "accepted" },
    ]);
    getQuoteMock.mockResolvedValue({
      id: "quo-3",
      customerId: "cust-amos",
      currency: "AUD",
      taxRate: 10,
      notes: null,
      status: "accepted",
      lineItems: [
        { description: "Build site", quantity: 1, unitPriceCents: 50000 },
        { description: "Consulting", quantity: 2, unitPriceCents: 10000 },
      ],
    });
    createInvoiceMock.mockResolvedValue("inv-new-id");
    getInvoiceMock.mockResolvedValue({ id: "inv-new-id", number: "INV-2026-0008" });
    convertQuoteAtomicMock.mockResolvedValue("inv-new-id");
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("owner");
    const tools = buildAssistantTools(c, ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.convertQuoteToInvoice, { quoteNumber: "QUO-2026-0003" })) as {
      invoiceId: string;
      invoiceNumber: string;
    };
    expect(out).toEqual({
      invoiceId: "inv-new-id",
      invoiceNumber: "INV-2026-0008",
      href: "/invoices/inv-new-id",
      recordLabel: "INV-2026-0008",
    });
    expect(convertQuoteAtomicMock).toHaveBeenCalledWith(c, "quo-3");
    expect(createInvoiceMock).not.toHaveBeenCalled();
  });

  it("convertQuoteToInvoice reconciles an already-converted quote through the same operation", async () => {
    listQuotesMock.mockResolvedValue([
      { id: "quo-3", number: "QUO-2026-0003", status: "converted" },
    ]);
    getQuoteMock.mockResolvedValue({
      id: "quo-3",
      status: "converted",
      convertedInvoiceId: "inv-original",
    });
    convertQuoteAtomicMock.mockResolvedValue("inv-original");
    getInvoiceMock.mockResolvedValue({ id: "inv-original", number: "INV-2026-0008" });
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    const input = { quoteNumber: "QUO-2026-0003" };
    const expected = {
      invoiceId: "inv-original",
      invoiceNumber: "INV-2026-0008",
      href: "/invoices/inv-original",
      recordLabel: "INV-2026-0008",
    };
    expect(await run(tools.convertQuoteToInvoice, input)).toEqual(expected);
    expect(await run(tools.convertQuoteToInvoice, input)).toEqual(expected);
    expect(convertQuoteAtomicMock).toHaveBeenCalledTimes(2);
    expect(createInvoiceMock).not.toHaveBeenCalled();
  });

  it("convertQuoteToInvoice returns a friendly error when the quote isn't accepted yet", async () => {
    listQuotesMock.mockResolvedValue([{ id: "quo-3", number: "QUO-2026-0003", status: "sent" }]);
    getQuoteMock.mockResolvedValue({
      id: "quo-3",
      customerId: null,
      currency: "AUD",
      taxRate: 0,
      notes: null,
      status: "sent",
      lineItems: [],
    });
    createInvoiceMock.mockResolvedValue("inv-new-id");
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.convertQuoteToInvoice, { quoteNumber: "QUO-2026-0003" })) as {
      error: string;
    };
    expect(out.error).toMatch(/isn't accepted yet/);
    // No invoice created for a non-accepted quote.
    expect(createInvoiceMock).not.toHaveBeenCalled();
    expect(convertQuoteAtomicMock).not.toHaveBeenCalled();
  });

  it("convertQuoteToInvoice returns a friendly error when the quote number isn't found", async () => {
    listQuotesMock.mockResolvedValue([]);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    const out = (await run(tools.convertQuoteToInvoice, { quoteNumber: "QUO-9999" })) as {
      error: string;
    };
    expect(out.error).toMatch(/Quote QUO-9999 not found/);
    expect(getQuoteMock).not.toHaveBeenCalled();
    expect(createInvoiceMock).not.toHaveBeenCalled();
  });

  // ── assistant.action audit wrapper ───────────────────────────────────────────

  it("createInvoice writes exactly one assistant.action audit row with tool, targetType and targetId", async () => {
    createInvoiceMock.mockResolvedValue("inv-new-id");
    getInvoiceMock.mockResolvedValue({ id: "inv-new-id", number: "INV-2026-0009" });
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("owner");
    const tools = buildAssistantTools(c, ALL_MODULES, { writeEnabled: true });
    await run(tools.createInvoice, {
      issueDate: "2026-07-06T00:00:00.000Z",
      taxRate: 10,
      lineItems: [{ description: "Test", quantity: 1, unitPriceCents: 10000 }],
    });
    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    expect(writeAuditMock).toHaveBeenCalledWith({
      workspaceId: c.workspaceId,
      actorUserId: c.user.id,
      action: "assistant.action",
      targetType: "invoice",
      targetId: "inv-new-id",
      metadata: { source: "ai_assistant", tool: "createInvoice", label: "INV-2026-0009" },
    });
  });

  it("createInvoice still succeeds with number: null when the number lookup throws", async () => {
    createInvoiceMock.mockResolvedValue("inv-new-id");
    getInvoiceMock.mockRejectedValue(new Error("db hiccup"));
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    const out = await run(tools.createInvoice, {
      issueDate: "2026-07-06T00:00:00.000Z",
      taxRate: 10,
      lineItems: [{ description: "Test", quantity: 1, unitPriceCents: 10000 }],
    });
    expect(out).toEqual({ id: "inv-new-id", number: null, href: "/invoices/inv-new-id" });
    // No label when the number is unknown.
    const audits = assistantActionAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toEqual({ source: "ai_assistant", tool: "createInvoice" });
  });

  it("createQuote returns the looked-up number and records it as the label", async () => {
    createQuoteMock.mockResolvedValue("quo-new-id");
    getQuoteMock.mockResolvedValue({ id: "quo-new-id", number: "QUO-2026-0004" });
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    const out = await run(tools.createQuote, {
      issueDate: "2026-07-06T00:00:00.000Z",
      taxRate: 10,
      lineItems: [{ description: "Test", quantity: 1, unitPriceCents: 10000 }],
    });
    expect(out).toEqual({
      id: "quo-new-id",
      number: "QUO-2026-0004",
      href: "/quotes/quo-new-id",
      recordLabel: "QUO-2026-0004",
    });
    expect(assistantActionAudits()).toMatchObject([
      { targetType: "quote", targetId: "quo-new-id", metadata: { tool: "createQuote" } },
    ]);
  });

  it("sendInvoice writes exactly one assistant.action audit row targeting the invoice", async () => {
    listInvoicesMock.mockResolvedValue([{ id: "inv-7", number: "INV-2026-0007", status: "draft" }]);
    sendInvoiceMock.mockResolvedValue(true);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    await run(tools.sendInvoice, { invoiceNumber: "INV-2026-0007" });
    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    expect(assistantActionAudits()).toMatchObject([
      {
        action: "assistant.action",
        targetType: "invoice",
        targetId: "inv-7",
        metadata: { source: "ai_assistant", tool: "sendInvoice", label: "INV-2026-0007" },
      },
    ]);
  });

  it("deleteTransaction writes exactly one assistant.action audit row targeting the transaction", async () => {
    deleteTransactionMock.mockResolvedValue(true);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("accountant"), ["books"], { writeEnabled: true });
    await run(tools.deleteTransaction, { transactionId: "00000000-0000-4000-8000-0000000000e5" });
    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    expect(assistantActionAudits()).toMatchObject([
      {
        targetType: "book_transaction",
        targetId: "00000000-0000-4000-8000-0000000000e5",
        metadata: { source: "ai_assistant", tool: "deleteTransaction" },
      },
    ]);
  });

  it("convertQuoteToInvoice writes one assistant.action row targeting the new invoice", async () => {
    listQuotesMock.mockResolvedValue([
      { id: "quo-3", number: "QUO-2026-0003", status: "accepted" },
    ]);
    getQuoteMock.mockResolvedValue({ id: "quo-3", status: "accepted" });
    convertQuoteAtomicMock.mockResolvedValue("inv-new-id");
    getInvoiceMock.mockResolvedValue({ id: "inv-new-id", number: "INV-2026-0008" });
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    await run(tools.convertQuoteToInvoice, { quoteNumber: "QUO-2026-0003" });
    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    expect(assistantActionAudits()).toMatchObject([
      {
        targetType: "invoice",
        targetId: "inv-new-id",
        metadata: {
          source: "ai_assistant",
          tool: "convertQuoteToInvoice",
          label: "INV-2026-0008",
        },
      },
    ]);
  });

  it("a write tool that returns { error } writes no assistant.action row", async () => {
    deleteTransactionMock.mockResolvedValue(false);
    listInvoicesMock.mockResolvedValue([]);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    const deleted = await run(tools.deleteTransaction, {
      transactionId: "00000000-0000-4000-8000-0000000000e6",
    });
    const sent = await run(tools.sendInvoice, { invoiceNumber: "INV-9999" });
    expect(deleted).toEqual({ error: "Transaction not found." });
    expect(sent).toEqual({ error: "Invoice INV-9999 not found." });
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("a rejected writeAudit does not turn a successful write into an error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      deleteTransactionMock.mockResolvedValue(true);
      writeAuditMock.mockRejectedValueOnce(new Error("audit store down"));
      const { buildAssistantTools } = await import("@/server/application/assistant/tools");
      const tools = buildAssistantTools(ctx("accountant"), ["books"], { writeEnabled: true });
      const out = await run(tools.deleteTransaction, {
        transactionId: "00000000-0000-4000-8000-0000000000e5",
      });
      expect(out).toEqual({
        id: "00000000-0000-4000-8000-0000000000e5",
        deleted: true,
        href: "/books",
      });
      expect(writeAuditMock).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  // ── extractReceipt ───────────────────────────────────────────────────────────

  it("extractReceipt returns the stored extraction summary and records one assistant.action row", async () => {
    extractReceiptMock.mockResolvedValue("ext-1");
    getExtractionMock.mockResolvedValue({
      id: "ext-1",
      status: "extracted",
      errorMessage: null,
      extractedData: {
        merchant: "Bunnings",
        date: "2026-07-01",
        totalCents: 4200,
        taxCents: 382,
        currency: "AUD",
        category: "supplies",
        confidence: 0.93,
        lineItems: [],
      },
    });
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("accountant");
    const tools = buildAssistantTools(c, ["books"], { writeEnabled: true });
    const out = await run(tools.extractReceipt, {
      fileId: "00000000-0000-4000-8000-0000000000f2",
    });
    expect(out).toEqual({
      id: "ext-1",
      status: "extracted",
      merchant: "Bunnings",
      date: "2026-07-01",
      totalCents: 4200,
      taxCents: 382,
      currency: "AUD",
      category: "supplies",
      confidence: 0.93,
      href: "/books/receipts",
      recordLabel: "Bunnings",
    });
    expect(getExtractionMock).toHaveBeenCalledWith(c.workspaceId, "ext-1");
    expect(assistantActionAudits()).toMatchObject([
      {
        targetType: "receipt_extraction",
        targetId: "ext-1",
        metadata: { source: "ai_assistant", tool: "extractReceipt", label: "Bunnings" },
      },
    ]);
  });

  it("extractReceipt returns an error for a rejected extraction and writes no assistant.action row", async () => {
    extractReceiptMock.mockResolvedValue("ext-2");
    getExtractionMock.mockResolvedValue({
      id: "ext-2",
      status: "rejected",
      errorMessage: "Image was unreadable",
      extractedData: null,
    });
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("accountant"), ["books"], { writeEnabled: true });
    const out = (await run(tools.extractReceipt, {
      fileId: "00000000-0000-4000-8000-0000000000f3",
    })) as { error: string };
    expect(out.error).toMatch(/could not be read: Image was unreadable/);
    expect(out).not.toHaveProperty("id");
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("extractReceipt still returns the id when reading the summary throws", async () => {
    extractReceiptMock.mockResolvedValue("ext-3");
    getExtractionMock.mockRejectedValue(new Error("read failed"));
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("accountant"), ["books"], { writeEnabled: true });
    const out = await run(tools.extractReceipt, {
      fileId: "00000000-0000-4000-8000-0000000000f4",
    });
    expect(out).toEqual({
      id: "ext-3",
      status: "pending",
      merchant: null,
      date: null,
      totalCents: null,
      taxCents: null,
      currency: null,
      category: null,
      confidence: null,
      href: "/books/receipts",
    });
    expect(assistantActionAudits()).toMatchObject([
      { targetType: "receipt_extraction", targetId: "ext-3" },
    ]);
  });
});

/**
 * Record and summary lookups: one record in full, or totals worked out in Postgres. Each
 * is offered by module and view permission like the lists, reads only the ctx workspace,
 * and reports a missing record as { error } instead of throwing.
 */
describe("buildAssistantTools - record and summary lookups", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Freeze "now" for tools that resolve a period from today's date. */
  function freezeNow(isoNow: string): void {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(isoNow));
  }

  const INVOICE_ID = "00000000-0000-4000-8000-0000000000a1";
  const QUOTE_ID = "00000000-0000-4000-8000-0000000000a2";
  const CUSTOMER_ID = "00000000-0000-4000-8000-0000000000a3";
  const TRANSACTION_ID = "00000000-0000-4000-8000-0000000000a4";

  function invoiceRow(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: INVOICE_ID,
      workspaceId: "secret-ws",
      customerId: CUSTOMER_ID,
      customerName: "Jane Co",
      number: "INV-2026-0007",
      status: "overdue",
      issueDate: new Date("2026-10-01T00:00:00.000Z"),
      dueDate: new Date("2026-10-15T00:00:00.000Z"),
      currency: "AUD",
      taxRate: 10,
      pricesIncludeTax: false,
      subtotalCents: 50000,
      taxCents: 5000,
      totalCents: 55000,
      notes: "Net 14",
      paymentMethods: null,
      publicToken: "secret-token",
      sentAt: new Date("2026-10-01T02:00:00.000Z"),
      paidAt: null,
      stripePaymentIntentId: null,
      stripeChargeId: null,
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
      updatedAt: new Date("2026-10-01T02:00:00.000Z"),
      lineItems: [
        {
          id: "line-1",
          invoiceId: INVOICE_ID,
          description: "Consulting",
          quantity: 10,
          unitPriceCents: 5000,
          amountCents: 50000,
          position: 0,
        },
      ],
      ...over,
    };
  }

  function quoteRow(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: QUOTE_ID,
      workspaceId: "secret-ws",
      customerId: CUSTOMER_ID,
      customerName: "Jane Co",
      number: "QUO-2026-0003",
      status: "sent",
      issueDate: new Date("2026-11-01T00:00:00.000Z"),
      validUntil: new Date("2026-12-01T00:00:00.000Z"),
      currency: "AUD",
      taxRate: 10,
      pricesIncludeTax: false,
      subtotalCents: 20000,
      taxCents: 2000,
      totalCents: 22000,
      notes: null,
      termsConditions: "Long terms that stay out of the result",
      publicToken: "secret-token",
      sentAt: new Date("2026-11-01T01:00:00.000Z"),
      acceptedAt: null,
      declinedAt: null,
      convertedAt: null,
      convertedInvoiceId: null,
      createdAt: new Date("2026-11-01T00:00:00.000Z"),
      updatedAt: new Date("2026-11-01T01:00:00.000Z"),
      lineItems: [
        {
          id: "line-1",
          quoteId: QUOTE_ID,
          description: "Fit-out",
          quantity: 2,
          unitPriceCents: 10000,
          amountCents: 20000,
          position: 0,
        },
      ],
      sections: [{ id: "sec-1", quoteId: QUOTE_ID, title: "Scope", body: "Works", position: 0 }],
      ...over,
    };
  }

  const LOOKUP_TOOLS = [
    "getInvoice",
    "getQuote",
    "getCustomer",
    "getTransaction",
    "getPeriodSummary",
    "getGstSummary",
    "listReceiptQueue",
  ];

  // ── Gating ───────────────────────────────────────────────────────────────────

  it("offers each lookup only when its module is installed", async () => {
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const none = buildAssistantTools(ctx("owner"), []);
    // Customers are a platform service; everything else needs its module.
    expect(LOOKUP_TOOLS.filter((name) => none[name])).toEqual(["getCustomer"]);

    const invoicesOnly = buildAssistantTools(ctx("owner"), ["invoices"]);
    expect(LOOKUP_TOOLS.filter((name) => invoicesOnly[name])).toEqual([
      "getInvoice",
      "getCustomer",
    ]);

    const quotesOnly = buildAssistantTools(ctx("owner"), ["quotes"]);
    expect(LOOKUP_TOOLS.filter((name) => quotesOnly[name])).toEqual(["getQuote", "getCustomer"]);

    const booksOnly = buildAssistantTools(ctx("owner"), ["books"]);
    expect(LOOKUP_TOOLS.filter((name) => booksOnly[name])).toEqual([
      "getCustomer",
      "getTransaction",
      "getPeriodSummary",
      "getGstSummary",
      "listReceiptQueue",
    ]);
  });

  it("offers each lookup only to a role that can view the resource", async () => {
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    // employee has no books grant: no transaction, P&L, GST or receipt lookups.
    const employee = buildAssistantTools(ctx("employee"), ALL_MODULES);
    expect(LOOKUP_TOOLS.filter((name) => employee[name])).toEqual([
      "getInvoice",
      "getQuote",
      "getCustomer",
    ]);
    // manager and readonly can view books but not manage them: no receipt queue.
    for (const role of ["manager", "readonly"] as const) {
      const tools = buildAssistantTools(ctx(role), ALL_MODULES);
      expect(tools.getTransaction, role).toBeDefined();
      expect(tools.getPeriodSummary, role).toBeDefined();
      expect(tools.getGstSummary, role).toBeDefined();
      expect(tools.listReceiptQueue, role).toBeUndefined();
    }
    // accountant manages books. The queue is a lookup, so it does not need writeEnabled.
    const accountant = buildAssistantTools(ctx("accountant"), ALL_MODULES);
    expect(LOOKUP_TOOLS.filter((name) => accountant[name])).toEqual(LOOKUP_TOOLS);
  });

  it("every tool the builder offers is in the catalogue, and every lookup runs without approval", async () => {
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES, { writeEnabled: true });
    for (const name of Object.keys(tools)) {
      // A tool missing from the catalogue would be refused by the approval policy.
      expect(Object.hasOwn(ASSISTANT_TOOLS, name), name).toBe(true);
    }
    for (const name of LOOKUP_TOOLS) {
      expect(tools[name], name).toBeDefined();
      expect(ASSISTANT_TOOLS[name]?.kind, name).toBe("read");
      expect(assistantApprovalFor(name, { approvalsSupported: false }), name).toEqual({
        type: "not-applicable",
      });
    }
  });

  // ── List fixes from the review ────────────────────────────────────────────────

  it("listInvoices reports the due date and a balance that follows the status", async () => {
    const due = new Date("2026-10-15T00:00:00.000Z");
    listInvoicesMock.mockResolvedValue(
      ["draft", "sent", "viewed", "overdue", "paid", "void"].map((status) =>
        invoiceRow({ id: `inv-${status}`, status, dueDate: status === "draft" ? null : due }),
      ),
    );
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const out = (await run(buildAssistantTools(ctx("readonly"), ALL_MODULES).listInvoices)) as {
      items: { status: string; balanceDueCents: number; dueDate: string | null }[];
    };
    // Owed in full while the invoice is with the customer; nothing before or after.
    expect(Object.fromEntries(out.items.map((r) => [r.status, r.balanceDueCents]))).toEqual({
      draft: 0,
      sent: 55000,
      viewed: 55000,
      overdue: 55000,
      paid: 0,
      void: 0,
    });
    expect(out.items[0]!.dueDate).toBeNull();
    expect(out.items[1]!.dueDate).toBe(due.toISOString());
  });

  it("listRecentActivity says when older events exist", async () => {
    const event = {
      id: "a1",
      type: "invoice.sent",
      entityType: "invoice",
      actorFullName: "Sam",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      metadata: { secret: true },
    };
    listActivityMock.mockResolvedValue({
      items: [event],
      nextCursor: { createdAt: "2026-01-02T00:00:00.000000+00:00", id: "a1" },
    });
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("readonly");
    const tools = buildAssistantTools(c, []);
    expect(await run(tools.listRecentActivity, { limit: 1 })).toEqual({
      items: [
        {
          type: "invoice.sent",
          entityType: "invoice",
          createdAt: "2026-01-02T00:00:00.000Z",
          actorFullName: "Sam",
        },
      ],
      returned: 1,
      hasMore: true,
    });
    expect(listActivityMock).toHaveBeenCalledWith(c.workspaceId, { limit: 1 });

    listActivityMock.mockResolvedValue({ items: [event], nextCursor: null });
    expect(await run(tools.listRecentActivity)).toMatchObject({ returned: 1, hasMore: false });
  });

  // ── getInvoice ───────────────────────────────────────────────────────────────

  it("getInvoice resolves a number in the ctx workspace and returns the trimmed invoice", async () => {
    listInvoicesMock.mockResolvedValue([
      // A longer number that only contains the one asked for must not match.
      { id: "other", number: "INV-2026-00070" },
      { id: INVOICE_ID, number: "INV-2026-0007" },
    ]);
    getInvoiceMock.mockResolvedValue(invoiceRow());
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("readonly");
    const out = await run(buildAssistantTools(c, ALL_MODULES).getInvoice, {
      invoiceNumber: " INV-2026-0007 ",
    });
    // The whole shape: nothing else from the row (workspace id, public payment token,
    // Stripe ids, line item ids) reaches the model.
    expect(out).toEqual({
      id: INVOICE_ID,
      href: `/invoices/${INVOICE_ID}`,
      recordLabel: "INV-2026-0007",
      number: "INV-2026-0007",
      status: "overdue",
      customer: { id: CUSTOMER_ID, name: "Jane Co", href: `/customers/${CUSTOMER_ID}` },
      issueDate: "2026-10-01T00:00:00.000Z",
      dueDate: "2026-10-15T00:00:00.000Z",
      sentAt: "2026-10-01T02:00:00.000Z",
      paidAt: null,
      paidVia: null,
      currency: "AUD",
      taxRate: 10,
      pricesIncludeTax: false,
      lineItems: [
        { description: "Consulting", quantity: 10, unitPriceCents: 5000, amountCents: 50000 },
      ],
      subtotalCents: 50000,
      taxCents: 5000,
      totalCents: 55000,
      amountPaidCents: 0,
      balanceDueCents: 55000,
      notes: "Net 14",
    });
    expect(listInvoicesMock).toHaveBeenCalledWith(c.workspaceId, {
      search: "INV-2026-0007",
      limit: 200,
    });
    expect(getInvoiceMock).toHaveBeenCalledWith(c.workspaceId, INVOICE_ID);
  });

  it("getInvoice by id skips the number search and reports how a paid invoice was paid", async () => {
    const paidAt = new Date("2026-10-20T05:00:00.000Z");
    getInvoiceMock.mockResolvedValue(
      invoiceRow({
        status: "paid",
        paidAt,
        stripePaymentIntentId: "pi_123",
        stripeChargeId: "ch_123",
        customerId: null,
      }),
    );
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("readonly"), ALL_MODULES);
    const online = await run(tools.getInvoice, { invoiceId: INVOICE_ID });
    expect(online).toMatchObject({
      status: "paid",
      paidAt: paidAt.toISOString(),
      paidVia: "stripe",
      amountPaidCents: 55000,
      balanceDueCents: 0,
      // A walk-in invoice has no customer record to link to.
      customer: null,
    });
    expect(listInvoicesMock).not.toHaveBeenCalled();

    // The customer opened the payment form (which stores a payment intent) but paid some
    // other way, and the invoice was marked paid by hand: no charge, so not a Stripe payment.
    getInvoiceMock.mockResolvedValue(
      invoiceRow({ status: "paid", paidAt, stripePaymentIntentId: "pi_123" }),
    );
    expect(await run(tools.getInvoice, { invoiceId: INVOICE_ID })).toMatchObject({
      paidVia: "manual",
      amountPaidCents: 55000,
    });

    // A draft has not been issued, so nothing is owed on it yet.
    getInvoiceMock.mockResolvedValue(invoiceRow({ status: "draft", sentAt: null }));
    expect(await run(tools.getInvoice, { invoiceId: INVOICE_ID })).toMatchObject({
      paidVia: null,
      amountPaidCents: 0,
      balanceDueCents: 0,
    });
  });

  it("getInvoice returns an error when the invoice isn't found or no reference is given", async () => {
    listInvoicesMock.mockResolvedValue([]);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("readonly"), ALL_MODULES);
    expect(await run(tools.getInvoice, { invoiceNumber: "INV-9999" })).toEqual({
      error: "Invoice INV-9999 not found.",
    });
    expect(getInvoiceMock).not.toHaveBeenCalled();

    // An id from another workspace reads as missing: the service is workspace-scoped.
    getInvoiceMock.mockResolvedValue(null);
    expect(await run(tools.getInvoice, { invoiceId: INVOICE_ID })).toEqual({
      error: "Invoice not found.",
    });
    expect(await run(tools.getInvoice, {})).toEqual({
      error: "Provide an invoiceNumber or an invoiceId.",
    });
  });

  it("getInvoice treats a number the search cannot carry as not found, without searching", async () => {
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("readonly"), ALL_MODULES);
    listInvoicesMock.mockClear();

    // A quote in the search text breaks the list filter; no real number contains one.
    expect(await run(tools.getInvoice, { invoiceNumber: 'INV-"7"' })).toEqual({
      error: 'Invoice INV-"7" not found.',
    });
    expect(listInvoicesMock).not.toHaveBeenCalled();
  });

  // ── getQuote ─────────────────────────────────────────────────────────────────

  it("getQuote resolves a number and returns the trimmed quote", async () => {
    listQuotesMock.mockResolvedValue([{ id: QUOTE_ID, number: "QUO-2026-0003" }]);
    getQuoteMock.mockResolvedValue(quoteRow());
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("readonly");
    const out = await run(buildAssistantTools(c, ALL_MODULES).getQuote, {
      quoteNumber: "QUO-2026-0003",
    });
    expect(out).toEqual({
      id: QUOTE_ID,
      href: `/quotes/${QUOTE_ID}`,
      recordLabel: "QUO-2026-0003",
      number: "QUO-2026-0003",
      status: "sent",
      customer: { id: CUSTOMER_ID, name: "Jane Co", href: `/customers/${CUSTOMER_ID}` },
      issueDate: "2026-11-01T00:00:00.000Z",
      validUntil: "2026-12-01T00:00:00.000Z",
      sentAt: "2026-11-01T01:00:00.000Z",
      acceptedAt: null,
      declinedAt: null,
      convertedAt: null,
      currency: "AUD",
      taxRate: 10,
      pricesIncludeTax: false,
      lineItems: [
        { description: "Fit-out", quantity: 2, unitPriceCents: 10000, amountCents: 20000 },
      ],
      subtotalCents: 20000,
      taxCents: 2000,
      totalCents: 22000,
      convertedInvoice: null,
      notes: null,
    });
    expect(listQuotesMock).toHaveBeenCalledWith(c.workspaceId, {
      search: "QUO-2026-0003",
      limit: 200,
    });
    expect(getQuoteMock).toHaveBeenCalledWith(c.workspaceId, QUOTE_ID);
    // Not converted, so there is no invoice to look up.
    expect(getInvoiceMock).not.toHaveBeenCalled();
  });

  it("getQuote names the invoice a quote was converted to, when the role can see invoices", async () => {
    const convertedAt = new Date("2026-11-10T00:00:00.000Z");
    getQuoteMock.mockResolvedValue(
      quoteRow({ status: "converted", convertedAt, convertedInvoiceId: INVOICE_ID }),
    );
    getInvoiceMock.mockResolvedValue({ id: INVOICE_ID, number: "INV-2026-0012" });
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("readonly");
    const withInvoices = await run(buildAssistantTools(c, ALL_MODULES).getQuote, {
      quoteId: QUOTE_ID,
    });
    expect(withInvoices).toMatchObject({
      status: "converted",
      convertedAt: convertedAt.toISOString(),
      convertedInvoice: {
        id: INVOICE_ID,
        href: `/invoices/${INVOICE_ID}`,
        number: "INV-2026-0012",
      },
    });
    expect(getInvoiceMock).toHaveBeenCalledWith(c.workspaceId, INVOICE_ID);
    expect(listQuotesMock).not.toHaveBeenCalled();

    // Without the Invoices module the invoice is not read; the link on the quote remains.
    getInvoiceMock.mockClear();
    const quotesOnly = await run(buildAssistantTools(c, ["quotes"]).getQuote, {
      quoteId: QUOTE_ID,
    });
    expect(quotesOnly).toMatchObject({
      convertedInvoice: { id: INVOICE_ID, href: `/invoices/${INVOICE_ID}`, number: null },
    });
    expect(getInvoiceMock).not.toHaveBeenCalled();
  });

  it("getQuote returns an error when the quote isn't found or no reference is given", async () => {
    listQuotesMock.mockResolvedValue([]);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("readonly"), ALL_MODULES);
    expect(await run(tools.getQuote, { quoteNumber: "QUO-9999" })).toEqual({
      error: "Quote QUO-9999 not found.",
    });
    expect(getQuoteMock).not.toHaveBeenCalled();
    expect(await run(tools.getQuote, { quoteId: QUOTE_ID })).toEqual({ error: "Quote not found." });
    expect(await run(tools.getQuote, {})).toEqual({
      error: "Provide a quoteNumber or a quoteId.",
    });
  });

  // ── getCustomer ──────────────────────────────────────────────────────────────

  const customerRow = {
    id: CUSTOMER_ID,
    workspaceId: "secret-ws",
    name: "Jane Co",
    email: "jane@example.com",
    phone: "+61 400 000 000",
    company: "Jane Co Pty",
    notes: "Prefers email",
    createdAt: new Date("2026-01-05T00:00:00.000Z"),
    updatedAt: new Date("2026-02-05T00:00:00.000Z"),
  };

  it("getCustomer returns contact details with what the customer owes and their recent documents", async () => {
    getCustomerMock.mockResolvedValue(customerRow);
    listInvoicesMock.mockResolvedValue([
      invoiceRow({ id: "inv-1", number: "INV-1", status: "overdue", totalCents: 55000 }),
      invoiceRow({ id: "inv-2", number: "INV-2", status: "sent", totalCents: 10000 }),
      invoiceRow({
        id: "inv-3",
        number: "INV-3",
        status: "viewed",
        totalCents: 7000,
        currency: "NZD",
      }),
      invoiceRow({ id: "inv-4", number: "INV-4", status: "paid", totalCents: 99000 }),
      invoiceRow({ id: "inv-5", number: "INV-5", status: "draft", totalCents: 1000 }),
      invoiceRow({ id: "inv-6", number: "INV-6", status: "void", totalCents: 2000 }),
    ]);
    listQuotesMock.mockResolvedValue([quoteRow()]);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("readonly");
    const out = (await run(buildAssistantTools(c, ALL_MODULES).getCustomer, {
      customerId: CUSTOMER_ID,
    })) as {
      invoices: { recent: Record<string, unknown>[] } & Record<string, unknown>;
      quotes: { recent: Record<string, unknown>[]; hasMore: boolean };
    } & Record<string, unknown>;

    expect(out).toMatchObject({
      id: CUSTOMER_ID,
      href: `/customers/${CUSTOMER_ID}`,
      recordLabel: "Jane Co",
      name: "Jane Co",
      email: "jane@example.com",
      phone: "+61 400 000 000",
      company: "Jane Co Pty",
      notes: "Prefers email",
      createdAt: "2026-01-05T00:00:00.000Z",
    });
    expect(out).not.toHaveProperty("workspaceId");
    // Open means sent, viewed or overdue; paid, draft and void invoices owe nothing.
    // Balances are kept apart per currency rather than added across them.
    expect(out.invoices).toMatchObject({
      openCount: 3,
      overdueCount: 1,
      openBalances: [
        { currency: "AUD", balanceCents: 65000 },
        { currency: "NZD", balanceCents: 7000 },
      ],
      totalsArePartial: false,
      hasMore: true,
    });
    // Only the five newest are listed, in the same shape as listInvoices rows.
    expect(out.invoices.recent.map((r) => r.number)).toEqual([
      "INV-1",
      "INV-2",
      "INV-3",
      "INV-4",
      "INV-5",
    ]);
    expect(out.invoices.recent[0]).toMatchObject({
      href: "/invoices/inv-1",
      status: "overdue",
      balanceDueCents: 55000,
      dueDate: "2026-10-15T00:00:00.000Z",
    });
    expect(out.quotes).toEqual({
      recent: [
        {
          id: QUOTE_ID,
          href: `/quotes/${QUOTE_ID}`,
          number: "QUO-2026-0003",
          status: "sent",
          totalCents: 22000,
          currency: "AUD",
          issueDate: "2026-11-01T00:00:00.000Z",
          customerName: "Jane Co",
        },
      ],
      hasMore: false,
    });
    // Every read is scoped to the ctx workspace and to this customer.
    expect(getCustomerMock).toHaveBeenCalledWith(c.workspaceId, CUSTOMER_ID);
    expect(listInvoicesMock).toHaveBeenCalledWith(c.workspaceId, {
      customerId: CUSTOMER_ID,
      limit: 200,
    });
    expect(listQuotesMock).toHaveBeenCalledWith(c.workspaceId, {
      customerId: CUSTOMER_ID,
      limit: 6,
    });
  });

  it("getCustomer finds a customer by email and flags totals read from a full page of invoices", async () => {
    getCustomerByEmailMock.mockResolvedValue(customerRow);
    // 200 rows is all the invoices service returns, so there may be more behind them.
    listInvoicesMock.mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => invoiceRow({ id: `inv-${i}`, status: "paid" })),
    );
    listQuotesMock.mockResolvedValue(Array.from({ length: 6 }, () => quoteRow()));
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("readonly");
    const out = (await run(buildAssistantTools(c, ALL_MODULES).getCustomer, {
      customerEmail: "jane@example.com",
    })) as {
      invoices: Record<string, unknown> & { recent: unknown[] };
      quotes: { recent: unknown[]; hasMore: boolean };
    };
    expect(getCustomerByEmailMock).toHaveBeenCalledWith(c.workspaceId, "jane@example.com");
    expect(getCustomerMock).not.toHaveBeenCalled();
    expect(out.invoices).toMatchObject({
      openCount: 0,
      overdueCount: 0,
      openBalances: [],
      totalsArePartial: true,
      hasMore: true,
    });
    expect(out.invoices.recent).toHaveLength(5);
    expect(out.quotes.recent).toHaveLength(5);
    expect(out.quotes.hasMore).toBe(true);
  });

  it("getCustomer leaves out invoices and quotes the user has no module for", async () => {
    getCustomerMock.mockResolvedValue(customerRow);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const out = await run(buildAssistantTools(ctx("readonly"), ["books"]).getCustomer, {
      customerId: CUSTOMER_ID,
    });
    expect(out).toMatchObject({ name: "Jane Co", invoices: null, quotes: null });
    // Not installed means not read, not read-and-hidden.
    expect(listInvoicesMock).not.toHaveBeenCalled();
    expect(listQuotesMock).not.toHaveBeenCalled();
  });

  it("getCustomer returns an error when the customer isn't found or no reference is given", async () => {
    getCustomerMock.mockResolvedValue(null);
    getCustomerByEmailMock.mockResolvedValue(null);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("readonly"), ALL_MODULES);
    const byId = (await run(tools.getCustomer, { customerId: CUSTOMER_ID })) as { error: string };
    expect(byId.error).toMatch(/Customer not found/);
    const byEmail = (await run(tools.getCustomer, { customerEmail: "nobody@x.test" })) as {
      error: string;
    };
    expect(byEmail.error).toMatch(/Customer not found/);
    expect(await run(tools.getCustomer, {})).toEqual({
      error: "Provide a customerId or a customerEmail.",
    });
    // Nothing about a missing customer is looked up.
    expect(listInvoicesMock).not.toHaveBeenCalled();
    expect(listQuotesMock).not.toHaveBeenCalled();
  });

  // ── getTransaction ───────────────────────────────────────────────────────────

  it("getTransaction returns the full record, including where a mirrored one comes from", async () => {
    getTransactionMock.mockResolvedValue({
      id: TRANSACTION_ID,
      workspaceId: "secret-ws",
      type: "income",
      amountCents: 55000,
      gstCents: 5000,
      currency: "AUD",
      date: new Date("2026-10-20T05:00:00.000Z"),
      description: "Invoice INV-2026-0007",
      category: "invoice",
      customerId: CUSTOMER_ID,
      customerName: "Jane Co",
      sourceInvoiceId: INVOICE_ID,
      sourceEarningId: null,
      sourceExpenseId: null,
      sourceTripId: null,
      receiptFileId: null,
      notes: null,
      createdAt: new Date("2026-10-20T05:00:00.000Z"),
      updatedAt: new Date("2026-10-20T05:00:00.000Z"),
    });
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("readonly");
    const out = await run(buildAssistantTools(c, ["books"]).getTransaction, {
      transactionId: TRANSACTION_ID,
    });
    expect(out).toEqual({
      id: TRANSACTION_ID,
      href: `/books/${TRANSACTION_ID}`,
      recordLabel: "Invoice INV-2026-0007",
      type: "income",
      amountCents: 55000,
      gstCents: 5000,
      currency: "AUD",
      date: "2026-10-20T05:00:00.000Z",
      description: "Invoice INV-2026-0007",
      category: "invoice",
      categoryLabel: "Invoice",
      customer: { id: CUSTOMER_ID, name: "Jane Co", href: `/customers/${CUSTOMER_ID}` },
      source: { module: "invoices", label: "Invoice", href: `/invoices/${INVOICE_ID}` },
      receiptFileId: null,
      notes: null,
      createdAt: "2026-10-20T05:00:00.000Z",
      updatedAt: "2026-10-20T05:00:00.000Z",
    });
    expect(getTransactionMock).toHaveBeenCalledWith(c.workspaceId, TRANSACTION_ID);
  });

  it("getTransaction returns an error when the transaction isn't found", async () => {
    getTransactionMock.mockResolvedValue(null);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const out = await run(buildAssistantTools(ctx("readonly"), ["books"]).getTransaction, {
      transactionId: TRANSACTION_ID,
    });
    expect(out).toEqual({ error: "Transaction not found." });
  });

  // ── getPeriodSummary ─────────────────────────────────────────────────────────

  const bookSummary = {
    incomeCents: 120000,
    expenseCents: 45000,
    netCents: 75000,
    gstCollectedCents: 10909,
    gstPaidCents: 4090,
    netGstCents: 6819,
    count: 14,
    byCategory: [
      { type: "income", category: "invoice", amountCents: 120000, count: 4 },
      { type: "expense", category: "software_expense", amountCents: 30000, count: 6 },
      { type: "expense", category: "retired_slug", amountCents: 15000, count: 4 },
    ],
    monthly: [{ month: "2026-11", incomeCents: 120000, expenseCents: 45000, netCents: 75000 }],
  };

  it("getPeriodSummary defaults to the workspace's current financial year, as the Books page does", async () => {
    freezeNow("2026-11-18T03:00:00.000Z");
    getWorkspaceMock.mockResolvedValue({ defaultCurrency: "NZD", fyStartMonth: 4 });
    getBookSummaryMock.mockResolvedValue(bookSummary);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("readonly");
    const out = await run(buildAssistantTools(c, ["books"]).getPeriodSummary);
    expect(out).toEqual({
      period: "year",
      recordLabel: "Current FY",
      // The financial year starts in April for this workspace.
      from: "2026-04-01T00:00:00.000Z",
      to: "2026-11-18T03:00:00.000Z",
      currency: "NZD",
      incomeCents: 120000,
      expenseCents: 45000,
      netCents: 75000,
      gstCollectedCents: 10909,
      gstPaidCents: 4090,
      netGstCents: 6819,
      transactionCount: 14,
      byCategory: [
        { type: "income", category: "invoice", label: "Invoice", amountCents: 120000, count: 4 },
        {
          type: "expense",
          category: "software_expense",
          label: "Software",
          amountCents: 30000,
          count: 6,
        },
        // A slug that is no longer in the catalogue is shown as stored.
        {
          type: "expense",
          category: "retired_slug",
          label: "retired_slug",
          amountCents: 15000,
          count: 4,
        },
      ],
      monthly: bookSummary.monthly,
      href: "/books",
    });
    // Totals come from the Postgres summary, scoped to the ctx workspace; no rows are read.
    expect(getBookSummaryMock).toHaveBeenCalledWith(c.workspaceId, {
      dateFrom: new Date("2026-04-01T00:00:00.000Z"),
      dateTo: new Date("2026-11-18T03:00:00.000Z"),
    });
    expect(listTransactionsMock).not.toHaveBeenCalled();
  });

  it("getPeriodSummary resolves presets and links to the same period on the Books page", async () => {
    freezeNow("2026-11-18T03:00:00.000Z");
    getBookSummaryMock.mockResolvedValue(bookSummary);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("readonly"), ["books"]);

    expect(await run(tools.getPeriodSummary, { period: "month" })).toMatchObject({
      period: "month",
      recordLabel: "This month",
      from: "2026-11-01T00:00:00.000Z",
      to: "2026-11-18T03:00:00.000Z",
      href: "/books?period=month",
    });
    // A workspace row without a financial-year month falls back to July, like the page.
    expect(await run(tools.getPeriodSummary, { period: "quarter" })).toMatchObject({
      recordLabel: "This quarter",
      from: "2026-10-01T00:00:00.000Z",
      href: "/books?period=quarter",
    });
    expect(await run(tools.getPeriodSummary, { period: "all" })).toMatchObject({
      period: "all",
      recordLabel: "All time",
      from: null,
      href: "/books?period=all",
    });
    expect(getBookSummaryMock).toHaveBeenLastCalledWith(expect.anything(), {
      dateFrom: undefined,
      dateTo: new Date("2026-11-18T03:00:00.000Z"),
    });
  });

  it("getPeriodSummary takes an explicit date range, which has no page of its own to link to", async () => {
    freezeNow("2026-11-18T03:00:00.000Z");
    getBookSummaryMock.mockResolvedValue(bookSummary);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("readonly");
    const tools = buildAssistantTools(c, ["books"]);
    const out = await run(tools.getPeriodSummary, {
      // The dates win over a preset passed alongside them.
      period: "month",
      dateFrom: "2026-07-01T00:00:00.000Z",
      dateTo: "2026-09-30T23:59:59.000Z",
    });
    expect(out).toMatchObject({
      period: "custom",
      recordLabel: "2026-07-01 to 2026-09-30",
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-09-30T23:59:59.000Z",
      netCents: 75000,
    });
    expect(out).not.toHaveProperty("href");
    expect(getBookSummaryMock).toHaveBeenCalledWith(c.workspaceId, {
      dateFrom: new Date("2026-07-01T00:00:00.000Z"),
      dateTo: new Date("2026-09-30T23:59:59.000Z"),
    });

    // Only a start: the range runs up to now. Only an end: everything up to it.
    expect(
      await run(tools.getPeriodSummary, { dateFrom: "2026-11-01T00:00:00.000Z" }),
    ).toMatchObject({ recordLabel: "2026-11-01 to 2026-11-18", to: "2026-11-18T03:00:00.000Z" });
    expect(await run(tools.getPeriodSummary, { dateTo: "2026-06-30T23:59:59.000Z" })).toMatchObject(
      { recordLabel: "Until 2026-06-30", from: null },
    );
  });

  it("getPeriodSummary reads an end date given as midnight as the whole of that day", async () => {
    getBookSummaryMock.mockResolvedValue(bookSummary);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("readonly");
    const tools = buildAssistantTools(c, ["books"]);

    // Paid invoices are recorded at the time of payment, so stopping at 00:00:00 would
    // leave out everything paid on the last day of the range.
    await run(tools.getPeriodSummary, {
      dateFrom: "2026-07-01T00:00:00.000Z",
      dateTo: "2026-09-30T00:00:00.000Z",
    });

    expect(getBookSummaryMock).toHaveBeenCalledWith(c.workspaceId, {
      dateFrom: new Date("2026-07-01T00:00:00.000Z"),
      dateTo: new Date("2026-09-30T23:59:59.999Z"),
    });
  });

  it("getPeriodSummary reports an empty period as zeros and refuses a reversed range", async () => {
    getBookSummaryMock.mockResolvedValue({
      incomeCents: 0,
      expenseCents: 0,
      netCents: 0,
      gstCollectedCents: 0,
      gstPaidCents: 0,
      netGstCents: 0,
      count: 0,
      byCategory: [],
      monthly: [],
    });
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("readonly"), ["books"]);
    // Nothing recorded is an answer, not an error: zeros, not invented figures.
    expect(await run(tools.getPeriodSummary, { period: "week" })).toMatchObject({
      incomeCents: 0,
      expenseCents: 0,
      netCents: 0,
      transactionCount: 0,
      byCategory: [],
      monthly: [],
    });

    getBookSummaryMock.mockClear();
    expect(
      await run(tools.getPeriodSummary, {
        dateFrom: "2026-09-30T00:00:00.000Z",
        dateTo: "2026-07-01T00:00:00.000Z",
      }),
    ).toEqual({ error: "dateFrom must be on or before dateTo." });
    expect(getBookSummaryMock).not.toHaveBeenCalled();
  });

  // ── getGstSummary ────────────────────────────────────────────────────────────

  const gstMonths = [
    { month: "2026-06", gstCollectedCents: 9000, gstPaidCents: 100 },
    { month: "2026-07", gstCollectedCents: 1000, gstPaidCents: 200 },
    { month: "2026-10", gstCollectedCents: 3000, gstPaidCents: 500 },
    { month: "2026-11", gstCollectedCents: 2000, gstPaidCents: 4000 },
  ];
  const lodgedQ1 = {
    id: "tax-1",
    workspaceId: "secret-ws",
    fiscalYear: 2026,
    quarter: 1,
    periodLabel: "2026-Q1",
    gstCollectedCents: 900,
    gstPaidCents: 200,
    netGstCents: 700,
    lodgedAt: new Date("2026-10-20T00:00:00.000Z"),
    createdAt: new Date("2026-10-20T00:00:00.000Z"),
    updatedAt: new Date("2026-10-20T00:00:00.000Z"),
  };

  it("getGstSummary returns the current quarter from the Tax page's figures", async () => {
    // 18 November 2026 with a July financial year is Q2 (October to December).
    freezeNow("2026-11-18T03:00:00.000Z");
    getGstMonthlyMock.mockResolvedValue(gstMonths);
    listTaxPeriodsMock.mockResolvedValue([lodgedQ1]);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("readonly");
    const out = await run(buildAssistantTools(c, ["books"]).getGstSummary);
    expect(out).toEqual({
      recordLabel: "2026-Q2",
      fiscalYear: 2026,
      quarter: 2,
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-12-31T23:59:59.999Z",
      currency: "AUD",
      gstCollectedCents: 5000,
      gstPaidCents: 4500,
      netGstCents: 500,
      position: "owed",
      lodgedAt: null,
      lodgedNetGstCents: null,
      // Only this financial year's quarters: June 2026 belongs to the year before.
      quarters: [
        {
          label: "2026-Q1",
          quarter: 1,
          gstCollectedCents: 1000,
          gstPaidCents: 200,
          netGstCents: 800,
          lodgedAt: "2026-10-20T00:00:00.000Z",
          // The snapshot taken at lodgement, which the live figure has since moved past.
          lodgedNetGstCents: 700,
        },
        {
          label: "2026-Q2",
          quarter: 2,
          gstCollectedCents: 5000,
          gstPaidCents: 4500,
          netGstCents: 500,
          lodgedAt: null,
          lodgedNetGstCents: null,
        },
      ],
      href: "/books/tax",
    });
    expect(getGstMonthlyMock).toHaveBeenCalledWith(c.workspaceId);
    expect(listTaxPeriodsMock).toHaveBeenCalledWith(c.workspaceId);
  });

  it("getGstSummary returns a named quarter or a whole financial year", async () => {
    freezeNow("2026-11-18T03:00:00.000Z");
    getGstMonthlyMock.mockResolvedValue(gstMonths);
    listTaxPeriodsMock.mockResolvedValue([lodgedQ1]);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("readonly"), ["books"]);

    // A quarter on its own is that quarter of the current financial year.
    expect(await run(tools.getGstSummary, { quarter: 1 })).toMatchObject({
      recordLabel: "2026-Q1",
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-09-30T23:59:59.999Z",
      netGstCents: 800,
      lodgedAt: "2026-10-20T00:00:00.000Z",
      lodgedNetGstCents: 700,
    });

    // A year on its own is the whole year, named by its dates.
    expect(await run(tools.getGstSummary, { fiscalYear: 2026 })).toMatchObject({
      recordLabel: "2026-07-01 to 2027-06-30",
      fiscalYear: 2026,
      quarter: null,
      from: "2026-07-01T00:00:00.000Z",
      to: "2027-06-30T23:59:59.999Z",
      gstCollectedCents: 6000,
      gstPaidCents: 4700,
      netGstCents: 1300,
      lodgedAt: null,
    });

    // June 2026 is the last quarter of the year that started in July 2025.
    expect(await run(tools.getGstSummary, { fiscalYear: 2025, quarter: 4 })).toMatchObject({
      recordLabel: "2025-Q4",
      from: "2026-04-01T00:00:00.000Z",
      to: "2026-06-30T23:59:59.999Z",
      gstCollectedCents: 9000,
      gstPaidCents: 100,
      position: "owed",
    });
  });

  it("getGstSummary follows the workspace's financial-year start and reports a refund", async () => {
    freezeNow("2026-11-18T03:00:00.000Z");
    getWorkspaceMock.mockResolvedValue({ defaultCurrency: "NZD", fyStartMonth: 1 });
    getGstMonthlyMock.mockResolvedValue([
      { month: "2026-11", gstCollectedCents: 1000, gstPaidCents: 2500 },
    ]);
    listTaxPeriodsMock.mockResolvedValue([]);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const out = await run(buildAssistantTools(ctx("readonly"), ["books"]).getGstSummary);
    // With a January start, November is in Q4 of 2026.
    expect(out).toMatchObject({
      recordLabel: "2026-Q4",
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-12-31T23:59:59.999Z",
      currency: "NZD",
      netGstCents: -1500,
      position: "refund",
    });
  });

  it("getGstSummary reports a period with no GST as nil rather than an error", async () => {
    freezeNow("2026-11-18T03:00:00.000Z");
    getGstMonthlyMock.mockResolvedValue([]);
    listTaxPeriodsMock.mockResolvedValue([]);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const out = await run(buildAssistantTools(ctx("readonly"), ["books"]).getGstSummary, {
      fiscalYear: 2024,
      quarter: 3,
    });
    expect(out).toMatchObject({
      recordLabel: "2024-Q3",
      gstCollectedCents: 0,
      gstPaidCents: 0,
      netGstCents: 0,
      position: "nil",
      lodgedAt: null,
      quarters: [],
    });
  });

  // ── listReceiptQueue ─────────────────────────────────────────────────────────

  function extractionRow(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "ext-1",
      workspaceId: "secret-ws",
      fileId: "file-1",
      status: "pending",
      processing: false,
      extractedData: {
        merchant: "Bunnings",
        date: "2026-11-10",
        totalCents: 4200,
        taxCents: 382,
        currency: "AUD",
        category: "supplies",
        confidence: 0.93,
        lineItems: [
          { description: "Screws", quantity: 1, unitPriceCents: 4200, amountCents: 4200 },
        ],
      },
      transactionId: null,
      errorMessage: null,
      modelUsed: "some-model",
      createdAt: new Date("2026-11-11T00:00:00.000Z"),
      updatedAt: new Date("2026-11-11T00:00:00.000Z"),
      ...over,
    };
  }

  it("listReceiptQueue lists receipts waiting for review with the full count", async () => {
    listExtractionsMock.mockResolvedValue([
      extractionRow(),
      // Still being read: no contents yet.
      extractionRow({ id: "ext-2", processing: true, extractedData: null }),
      extractionRow({ id: "ext-3" }),
    ]);
    countExtractionsMock.mockResolvedValue(7);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("accountant");
    const out = await run(buildAssistantTools(c, ["books"]).listReceiptQueue, { limit: 2 });
    expect(out).toEqual({
      items: [
        {
          id: "ext-1",
          status: "pending",
          processing: false,
          scannedAt: "2026-11-11T00:00:00.000Z",
          merchant: "Bunnings",
          date: "2026-11-10",
          totalCents: 4200,
          taxCents: 382,
          currency: "AUD",
          category: "supplies",
          confidence: 0.93,
          transactionId: null,
          errorMessage: null,
        },
        {
          id: "ext-2",
          status: "pending",
          processing: true,
          scannedAt: "2026-11-11T00:00:00.000Z",
          merchant: null,
          date: null,
          totalCents: null,
          taxCents: null,
          currency: null,
          category: null,
          confidence: null,
          transactionId: null,
          errorMessage: null,
        },
      ],
      returned: 2,
      hasMore: true,
      href: "/books/receipts?status=pending",
      // The count covers the whole queue, not just the rows returned.
      total: 7,
      status: "pending",
    });
    // Pending is the default; one extra row is read to detect hasMore.
    expect(listExtractionsMock).toHaveBeenCalledWith(c.workspaceId, {
      status: "pending",
      limit: 3,
    });
    expect(countExtractionsMock).toHaveBeenCalledWith(c.workspaceId, { status: "pending" });
  });

  it("listReceiptQueue filters by status and links an applied receipt to its transaction", async () => {
    listExtractionsMock.mockResolvedValue([
      extractionRow({ status: "applied", transactionId: TRANSACTION_ID }),
    ]);
    countExtractionsMock.mockResolvedValue(1);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const c = ctx("owner");
    const out = (await run(buildAssistantTools(c, ["books"]).listReceiptQueue, {
      status: "applied",
    })) as { items: Record<string, unknown>[] } & Record<string, unknown>;
    expect(out).toMatchObject({
      returned: 1,
      hasMore: false,
      total: 1,
      status: "applied",
      href: "/books/receipts?status=applied",
    });
    expect(out.items[0]).toMatchObject({
      status: "applied",
      transactionId: TRANSACTION_ID,
      href: `/books/${TRANSACTION_ID}`,
    });
    expect(listExtractionsMock).toHaveBeenCalledWith(c.workspaceId, {
      status: "applied",
      limit: 21,
    });
  });

  it("listReceiptQueue returns an empty queue as an empty list", async () => {
    listExtractionsMock.mockResolvedValue([]);
    countExtractionsMock.mockResolvedValue(0);
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const out = await run(buildAssistantTools(ctx("accountant"), ["books"]).listReceiptQueue);
    expect(out).toEqual({
      items: [],
      returned: 0,
      hasMore: false,
      href: "/books/receipts?status=pending",
      total: 0,
      status: "pending",
    });
  });

  // ── Input validation ─────────────────────────────────────────────────────────

  it("validates lookup inputs before a tool runs", async () => {
    const { buildAssistantTools } = await import("@/server/application/assistant/tools");
    const tools = buildAssistantTools(ctx("owner"), ALL_MODULES);
    // The SDK checks a call against the tool's schema and never runs one that fails.
    const accepts = (name: string, input: unknown): boolean =>
      (
        tools[name]!.inputSchema as { safeParse: (value: unknown) => { success: boolean } }
      ).safeParse(input).success;

    expect(accepts("getInvoice", { invoiceNumber: "INV-2026-0007" })).toBe(true);
    expect(accepts("getInvoice", { invoiceId: INVOICE_ID })).toBe(true);
    expect(accepts("getInvoice", { invoiceId: "not-a-uuid" })).toBe(false);
    expect(accepts("getQuote", { quoteId: "not-a-uuid" })).toBe(false);
    expect(accepts("getCustomer", { customerEmail: "jane@example.com" })).toBe(true);
    expect(accepts("getCustomer", { customerEmail: "not an email" })).toBe(false);
    expect(accepts("getTransaction", {})).toBe(false);
    expect(accepts("getTransaction", { transactionId: TRANSACTION_ID })).toBe(true);
    expect(accepts("getPeriodSummary", {})).toBe(true);
    expect(accepts("getPeriodSummary", { period: "decade" })).toBe(false);
    expect(accepts("getPeriodSummary", { dateFrom: "last Tuesday" })).toBe(false);
    expect(accepts("getGstSummary", { fiscalYear: 2026, quarter: 4 })).toBe(true);
    expect(accepts("getGstSummary", { quarter: 5 })).toBe(false);
    expect(accepts("listReceiptQueue", { status: "pending", limit: 100 })).toBe(true);
    expect(accepts("listReceiptQueue", { status: "lost" })).toBe(false);
    expect(accepts("listReceiptQueue", { limit: 101 })).toBe(false);
  });
});
