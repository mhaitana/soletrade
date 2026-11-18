import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantUsageMonth } from "@/server/application/assistant/usage";

const loadAssistantUsage = vi.hoisted(() => vi.fn());
vi.mock("@/features/assistant/api/usage", () => ({ loadAssistantUsage }));

import { UsageCard, UsageCardView } from "@/features/assistant/components/usage-card";

function month(
  name: string,
  features: { feature: string; calls: number; input: number; output: number; cacheRead: number }[],
): AssistantUsageMonth {
  const rows = features.map((f) => ({
    feature: f.feature,
    calls: f.calls,
    inputTokens: f.input,
    outputTokens: f.output,
    cacheReadTokens: f.cacheRead,
    cacheWriteTokens: 0,
  }));
  return {
    month: name,
    features: rows,
    totals: {
      calls: rows.reduce((sum, row) => sum + row.calls, 0),
      inputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
      outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
      cacheReadTokens: rows.reduce((sum, row) => sum + row.cacheReadTokens, 0),
      cacheWriteTokens: 0,
    },
  };
}

const november = month("2026-11", [
  { feature: "chat", calls: 42, input: 1_200_000, output: 34_500, cacheRead: 900_000 },
  { feature: "receipt", calls: 3, input: 6_000, output: 900, cacheRead: 0 },
  { feature: "title", calls: 12, input: 1_500, output: 90, cacheRead: 0 },
]);
const october = month("2026-10", [
  { feature: "chat", calls: 7, input: 80_000, output: 2_000, cacheRead: 20_000 },
]);
const september = month("2026-09", []);

beforeEach(() => loadAssistantUsage.mockReset());

describe("UsageCardView", () => {
  it("shows this month's requests, tokens and the share of input served from cache", () => {
    render(<UsageCardView usage={{ current: november, previous: [october, september] }} />);
    expect(screen.getByText("Usage")).toBeInTheDocument();
    expect(screen.getByText("This month, November 2026")).toBeInTheDocument();

    const stat = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling!;
    // Requests to a model across the features: 42 chat, 3 receipt, 12 title.
    expect(stat("Requests")).toHaveTextContent("57");
    // Not "turns": a reply that pauses for an approval and continues is two requests.
    expect(screen.queryByText(/turns/i)).toBeNull();
    expect(stat("Input tokens")).toHaveTextContent("1,207,500");
    expect(stat("Output tokens")).toHaveTextContent("35,490");
    // 900,000 of 1,207,500 input tokens came from the cache.
    expect(stat("Input from cache")).toHaveTextContent("75%");
    // Numbers are set in the tabular mono face, like the other figures in settings.
    expect(stat("Requests")).toHaveClass("font-mono", "tabular-nums");
  });

  it("breaks the month down by feature", () => {
    render(<UsageCardView usage={{ current: november, previous: [october, september] }} />);
    const table = screen.getByRole("table", { name: "Usage in November 2026 by feature" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["42", "1,200,000", "34,500", "75%"],
      ["3", "6,000", "900", "0%"],
      ["12", "1,500", "90", "0%"],
    ]);
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual([
      "Chat",
      "Receipt scans",
      "Conversation titles",
    ]);
    for (const cell of within(table).getAllByRole("cell")) {
      expect(cell).toHaveClass("font-mono", "tabular-nums");
    }
  });

  it("lists the two months before, including one with nothing in it", () => {
    render(<UsageCardView usage={{ current: november, previous: [october, september] }} />);
    const table = screen.getByRole("table", { name: "Usage in the two months before" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(
      rows.map((row) => [
        within(row).getByRole("rowheader").textContent,
        ...within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      ]),
    ).toEqual([
      ["October 2026", "7", "80,000", "2,000", "25%"],
      // No input, so there is no share to show.
      ["September 2026", "0", "0", "0", "-"],
    ]);
  });

  it("names a feature it has no label for by its own name", () => {
    render(
      <UsageCardView
        usage={{
          current: month("2026-11", [
            { feature: "daily_digest", calls: 1, input: 10, output: 1, cacheRead: 0 },
          ]),
          previous: [october, september],
        }}
      />,
    );
    expect(screen.getByRole("rowheader", { name: "Daily digest" })).toBeInTheDocument();
  });

  it("says so when nothing has been used at all", () => {
    render(
      <UsageCardView
        usage={{ current: month("2026-11", []), previous: [month("2026-10", []), september] }}
      />,
    );
    expect(screen.getByText(/Nothing used yet/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("still shows earlier months when this month is empty so far", () => {
    render(
      <UsageCardView usage={{ current: month("2026-11", []), previous: [october, september] }} />,
    );
    expect(screen.getByText("Nothing used so far this month.")).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Usage in the two months before" }),
    ).toBeInTheDocument();
  });
});

describe("UsageCard", () => {
  it("renders the card for someone who may see usage", async () => {
    loadAssistantUsage.mockResolvedValue({
      access: true,
      usage: { current: november, previous: [october, september] },
    });
    render(await UsageCard());
    expect(screen.getByText("This month, November 2026")).toBeInTheDocument();
  });

  it("renders nothing for everyone else", async () => {
    loadAssistantUsage.mockResolvedValue({ access: false });
    expect(await UsageCard()).toBeNull();
  });

  it("says usage can't be shown when the ledger could not be read", async () => {
    loadAssistantUsage.mockResolvedValue({ access: true, usage: null });
    render(await UsageCard());
    expect(screen.getByText("Usage")).toBeInTheDocument();
    expect(screen.getByText(/Usage can't be shown right now/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
