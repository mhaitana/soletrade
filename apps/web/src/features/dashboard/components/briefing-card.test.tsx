import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { onHaiAsk } from "@/lib/assistant/launcher";
import type { BriefingCardData } from "@/features/dashboard/api/actions";
import { BriefingCard } from "@/features/dashboard/components/briefing-card";

const briefing: BriefingCardData = {
  headline: "2 invoices are overdue, totalling $350.50. Also waiting: 1 receipt to review.",
  asOf: "2026-11-18T20:41:00.000Z",
  asOfLabel: "19 Nov, 7:41 am",
  links: [
    { id: "overdue-invoices", label: "Review overdue", href: "/invoices?status=overdue" },
    { id: "pending-receipts", label: "Review receipts", href: "/books/receipts?status=pending" },
  ],
};

const nothing: BriefingCardData = {
  ...briefing,
  headline: "Nothing needs your attention right now.",
  links: [],
};

describe("BriefingCard", () => {
  it("shows the headline, when it was read, and a link to each list", () => {
    render(<BriefingCard briefing={briefing} />);

    const card = screen.getByRole("region", { name: "Briefing" });
    expect(within(card).getByText(briefing.headline)).toBeInTheDocument();
    const time = within(card).getByText("19 Nov, 7:41 am");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", "2026-11-18T20:41:00.000Z");
    expect(within(card).getByRole("link", { name: "Review overdue" })).toHaveAttribute(
      "href",
      "/invoices?status=overdue",
    );
    expect(within(card).getByRole("link", { name: "Review receipts" })).toHaveAttribute(
      "href",
      "/books/receipts?status=pending",
    );
  });

  it("shows only the sentence when there is nothing to report", () => {
    render(<BriefingCard briefing={nothing} />);

    const card = screen.getByRole("region", { name: "Briefing" });
    expect(within(card).getByText("Nothing needs your attention right now.")).toBeInTheDocument();
    expect(within(card).queryByRole("list")).not.toBeInTheDocument();
    expect(within(card).queryByRole("link")).not.toBeInTheDocument();
  });

  it("offers Ask hAI as a secondary action, whether or not anything is waiting", () => {
    for (const data of [briefing, nothing]) {
      const { unmount } = render(<BriefingCard briefing={data} />);
      const card = screen.getByRole("region", { name: "Briefing" });
      const ask = within(card).getByRole("button", { name: "Ask hAI" });
      expect(ask).toHaveAttribute("data-variant", "outline");
      expect(ask).toHaveAttribute("type", "button");
      unmount();
    }
  });

  it("asks hAI what to pay attention to today, as a new conversation", async () => {
    const asked = vi.fn();
    const stop = onHaiAsk(asked);
    const user = userEvent.setup();
    render(<BriefingCard briefing={briefing} />);

    await user.click(screen.getByRole("button", { name: "Ask hAI" }));
    stop();

    expect(asked).toHaveBeenCalledTimes(1);
    expect(asked).toHaveBeenCalledWith({
      question: "What should I pay attention to today?",
      send: true,
    });
  });
});
