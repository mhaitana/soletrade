import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/server/infrastructure/db/types";
import { getDataClient } from "@/server/infrastructure/db/client";
import { branded } from "@/types/ids";
import { parsePage } from "@/utils/pagination";
import { listInvoices } from "@/server/domains/invoices/index";
import { listQuotes } from "@/server/domains/quotes/index";
import InvoicesPage from "@/features/invoices/components/pages/page";
import QuotesPage from "@/features/quotes/components/pages/page";

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

const WORKSPACE_ID = branded<"WorkspaceId">("00000000-0000-4000-8000-000000000001");
const requests: URL[] = [];
let rowCount: number;

function documentRow(index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(1000 - index).padStart(12, "0")}`,
    workspace_id: WORKSPACE_ID,
    customer_id: null,
    number: `DOC-${String(index + 1).padStart(3, "0")}`,
    status: "draft",
    issue_date: "2026-09-01T00:00:00",
    due_date: null,
    valid_until: null,
    currency: "AUD",
    tax_rate: 0,
    prices_include_tax: false,
    subtotal_cents: 10000,
    tax_cents: 0,
    total_cents: 10000,
    notes: null,
    payment_methods: null,
    terms_conditions: null,
    public_token: null,
    sent_at: null,
    paid_at: null,
    accepted_at: null,
    declined_at: null,
    converted_at: null,
    converted_invoice_id: null,
    stripe_payment_intent_id: null,
    stripe_charge_id: null,
    created_at: "2026-09-01T00:00:00",
    updated_at: "2026-09-01T00:00:00",
    customers: null,
    workspaces: { name: "Documents workspace" },
  };
}

// Keep page, loader, service, and query builder real; intercept the HTTP
// boundary so tests cannot mutate or contact the live demo database.
const client = createClient<Database>("https://document-pagination.example.test", "test-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: {
    fetch: async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 1000);
      const rows = url.pathname.endsWith("/customers")
        ? []
        : Array.from({ length: rowCount }, (_, index) => documentRow(index)).slice(
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
  rowCount = 137;
  vi.mocked(getDataClient).mockReturnValue(client);
});

it.each(
  ["0", "-2", "1.5", "1e3", "oops", "9007199254740991", ["2", "3"], undefined].map((page) => ({
    page,
  })),
)("normalizes invalid page input $page to the first page", ({ page }) =>
  expect(parsePage(page)).toBe(1),
);

describe.each([
  { module: "invoices", Page: InvoicesPage, list: listInvoices },
  { module: "quotes", Page: QuotesPage, list: listQuotes },
])("$module pagination", ({ module, Page, list }) => {
  it("reaches records beyond 100 with bounded queries and preserves filters in page links", async () => {
    render(
      await Page({
        searchParams: Promise.resolve({ page: "5", status: "draft", search: " ACME & partners " }),
      }),
    );

    expect(screen.getByRole("link", { name: "DOC-101" })).toBeVisible();
    expect(screen.getByRole("link", { name: "DOC-125" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "DOC-126" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(26);
    const request = requests.find((url) => url.pathname.endsWith(`/${module}`))!;
    expect(request.searchParams.get("offset")).toBe("100");
    expect(request.searchParams.get("limit")).toBe("26");
    expect(request.searchParams.get("order")).toBe("issue_date.desc,created_at.desc,id.desc");
    expect(request.searchParams.get("workspace_id")).toBe(`eq.${WORKSPACE_ID}`);
    expect(request.searchParams.get("status")).toBe("eq.draft");
    expect(request.searchParams.get("or")).toContain("ACME & partners");

    const pagination = within(screen.getByRole("navigation", { name: "Pagination" }));
    for (const [name, page] of [
      ["Previous", "4"],
      ["Next", "6"],
    ]) {
      const href = pagination.getByRole("link", { name }).getAttribute("href")!;
      const url = new URL(href, "https://app.example.test");
      expect(url.pathname).toBe(`/${module}`);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        status: "draft",
        search: "ACME & partners",
        page,
      });
    }
  });

  it("resets to the first page when changing status or submitting search", async () => {
    render(
      await Page({ searchParams: Promise.resolve({ page: "5", status: "draft", search: "ACME" }) }),
    );

    const filters = within(screen.getByRole("group", { name: `Filter ${module} by status` }));
    const url = new URL(
      filters.getByRole("link", { name: "Sent" }).getAttribute("href")!,
      "https://app.example.test",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: "sent", search: "ACME" });
    const form = screen.getByRole("search") as HTMLFormElement;
    expect(form.getAttribute("action")).toBe(`/${module}`);
    expect(Object.fromEntries(new FormData(form))).toEqual({ status: "draft", search: "ACME" });
  });

  it("disables next on the final page and keeps a link back", async () => {
    render(await Page({ searchParams: Promise.resolve({ page: "6" }) }));

    expect(screen.getByRole("link", { name: "DOC-137" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      `/${module}?page=5`,
    );
  });

  it("does not offer a next page when the result contains exactly one page", async () => {
    rowCount = 25;
    render(await Page({ searchParams: Promise.resolve({}) }));

    expect(screen.getAllByRole("row")).toHaveLength(26);
    expect(screen.queryByRole("link", { name: "Next" })).not.toBeInTheDocument();
  });

  it("offers a filtered first-page link for an out-of-range page without suggesting an empty workspace", async () => {
    render(
      await Page({
        searchParams: Promise.resolve({ page: "99", status: "draft", search: "ACME" }),
      }),
    );

    expect(screen.getByText(`No ${module} on this page.`)).toBeVisible();
    const first = new URL(
      screen.getByRole("link", { name: "Return to first page" }).getAttribute("href")!,
      "https://app.example.test",
    );
    expect(Object.fromEntries(first.searchParams)).toEqual({ status: "draft", search: "ACME" });
    expect(screen.queryByRole("link", { name: /Create your first/ })).not.toBeInTheDocument();
  });

  it.each(["-2", ["2", "3"]].map((page) => ({ page })))(
    "falls back to the first page for invalid page input $page",
    async ({ page }) => {
      render(await Page({ searchParams: Promise.resolve({ page }) }));

      expect(screen.getByRole("link", { name: "DOC-001" })).toBeVisible();
      const request = requests.find((url) => url.pathname.endsWith(`/${module}`))!;
      expect(request.searchParams.get("offset")).toBe("0");
      expect(request.searchParams.get("limit")).toBe("26");
    },
  );

  it("keeps the existing default list size for non-page consumers", async () => {
    expect(await list(WORKSPACE_ID)).toHaveLength(100);
    expect(requests[0]!.searchParams.get("limit")).toBe("100");
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER])(
    "normalizes an unsafe service offset %s to zero",
    async (offset) => {
      const rows = await list(WORKSPACE_ID, { offset, limit: 26 });
      expect(rows[0]?.number).toBe("DOC-001");
      expect(requests[0]!.searchParams.get("offset")).toBe("0");
    },
  );
});
