import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/server/infrastructure/db/types";
import { getDataClient } from "@/server/infrastructure/db/client";
import { branded } from "@/types/ids";
import { listExtractions } from "@/server/domains/books/receipt-extraction";
import ReceiptsPage from "@/features/books/components/pages/receipts/page";

vi.mock("@/server/infrastructure/db/client", () => ({ getDataClient: vi.fn() }));
vi.mock("@/server/application/auth/workspace-context", () => ({
  requireWorkspaceContext: vi.fn().mockResolvedValue({
    workspaceId: "00000000-0000-4000-8000-000000000001",
    role: "owner",
    user: { id: "owner", email: "owner@example.test" },
  }),
}));
vi.mock("@/server/foundation/module-installations/index", () => ({
  isModuleEnabled: vi.fn().mockResolvedValue(true),
}));
// The page now includes the Scan a receipt control, which refreshes the route after a scan.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const WORKSPACE_ID = branded<"WorkspaceId">("00000000-0000-4000-8000-000000000001");
const requests: URL[] = [];
let rowCount: number;

function extractionRow(index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(1000 - index).padStart(12, "0")}`,
    workspace_id: WORKSPACE_ID,
    file_id: `00000000-0000-4000-8001-${String(index).padStart(12, "0")}`,
    status: "pending",
    extracted_data: {
      merchant: `Merchant ${index + 1}`,
      date: "2026-09-01",
      totalCents: 10000 + index,
      taxCents: 1000,
      currency: "AUD",
      category: "supplies",
      lineItems: [],
      confidence: 0.9,
    },
    transaction_id: null,
    error_message: null,
    model_used: "test-model",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  };
}

const client = createClient<Database>("https://receipt-pagination.example.test", "test-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: {
    fetch: async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 1000);
      const rows = Array.from({ length: rowCount }, (_, index) => extractionRow(index)).slice(
        offset,
        offset + limit,
      );
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  },
});

beforeEach(() => {
  requests.length = 0;
  rowCount = 52;
  vi.mocked(getDataClient).mockReturnValue(client);
});

describe("receipt review pagination", () => {
  it("loads 25 review cards beyond the first page with a stable bounded query", async () => {
    render(
      await ReceiptsPage({
        searchParams: Promise.resolve({ page: "2", status: "pending" }),
      }),
    );

    expect(screen.getByDisplayValue("Merchant 26")).toBeVisible();
    expect(screen.getByDisplayValue("Merchant 50")).toBeVisible();
    expect(screen.queryByDisplayValue("Merchant 51")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Apply" })).toHaveLength(25);

    const request = requests[0]!;
    expect(request.pathname).toBe("/rest/v1/receipt_extractions");
    expect(request.searchParams.get("workspace_id")).toBe(`eq.${WORKSPACE_ID}`);
    expect(request.searchParams.get("status")).toBe("eq.pending");
    expect(request.searchParams.get("offset")).toBe("25");
    expect(request.searchParams.get("limit")).toBe("26");
    expect(request.searchParams.get("order")).toBe("created_at.desc,id.desc");
  });

  it("preserves status across page links and resets it when changing filters", async () => {
    render(
      await ReceiptsPage({
        searchParams: Promise.resolve({ page: "2", status: "pending" }),
      }),
    );

    const pagination = within(screen.getByRole("navigation", { name: "Pagination" }));
    expect(pagination.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/books/receipts?status=pending",
    );
    expect(pagination.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/books/receipts?status=pending&page=3",
    );
    const filters = within(screen.getByRole("group", { name: "Filter extractions by status" }));
    expect(filters.getByRole("link", { name: "Applied" })).toHaveAttribute(
      "href",
      "/books/receipts?status=applied",
    );
  });

  it("disables next on the final page", async () => {
    render(await ReceiptsPage({ searchParams: Promise.resolve({ page: "3" }) }));

    expect(screen.getByDisplayValue("Merchant 52")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/books/receipts?page=2",
    );
  });

  it("offers a filtered first-page recovery instead of an empty-workspace message", async () => {
    render(
      await ReceiptsPage({
        searchParams: Promise.resolve({ page: "99", status: "pending" }),
      }),
    );

    expect(screen.getByText("No receipts on this page.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Return to first page" })).toHaveAttribute(
      "href",
      "/books/receipts?status=pending",
    );
    expect(screen.queryByText("No pending receipts.")).not.toBeInTheDocument();
  });

  it("falls back to the first page for invalid or repeated page input", async () => {
    render(
      await ReceiptsPage({
        searchParams: Promise.resolve({ page: ["2", "3"], status: "pending" }),
      }),
    );

    expect(screen.getByDisplayValue("Merchant 1")).toBeVisible();
    expect(requests[0]!.searchParams.get("offset")).toBe("0");
  });

  it("keeps the service's 100-row default for other consumers", async () => {
    rowCount = 137;

    expect(await listExtractions(WORKSPACE_ID)).toHaveLength(100);
    expect(requests[0]!.searchParams.get("limit")).toBe("100");
    expect(requests[0]!.searchParams.get("offset")).toBe("0");
  });
});
