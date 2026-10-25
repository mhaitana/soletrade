import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEarningsAction } from "@/features/drive/api/actions";
import { DriveEarningsForm } from "@/features/drive/components/drive-earnings-form";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/features/drive/api/actions", () => ({ createEarningsAction: vi.fn() }));

function rowForDate(date: string) {
  const input = screen
    .getAllByLabelText("Date")
    .find((input) => (input as HTMLInputElement).value === date);
  expect(input).toBeDefined();
  return within(input!.closest("fieldset")!);
}

describe("DriveEarningsForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createEarningsAction).mockReset();
  });

  it("adds Monday to Sunday across a month boundary without duplicating entered days", async () => {
    const user = userEvent.setup();
    render(<DriveEarningsForm defaultCurrency="AUD" initialDate="2026-10-25" />);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-30" } });
    await user.type(screen.getByLabelText("Amount (AUD)"), "123.45");
    fireEvent.change(screen.getByLabelText("Week starting"), { target: { value: "2026-09-28" } });
    await user.click(screen.getByRole("button", { name: "Add a week" }));
    expect(
      screen.getAllByLabelText("Date").map((input) => (input as HTMLInputElement).value),
    ).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(rowForDate("2026-09-30").getByLabelText("Amount (AUD)")).toHaveValue(123.45);
    await user.click(screen.getByRole("button", { name: "Add a week" }));
    expect(screen.getAllByLabelText("Date")).toHaveLength(7);
  });

  it("saves different days and platforms together, skips days off and totals cents accurately", async () => {
    vi.mocked(createEarningsAction).mockResolvedValue({ ok: true, earningIds: ["one", "two"] });
    const user = userEvent.setup();
    render(<DriveEarningsForm defaultCurrency="AUD" initialDate="2026-10-25" />);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-19" } });
    fireEvent.change(screen.getByLabelText("Week starting"), { target: { value: "2026-10-19" } });
    await user.click(screen.getByRole("button", { name: "Add a week" }));
    await user.type(rowForDate("2026-10-19").getByLabelText("Amount (AUD)"), "100.10");
    const tuesday = rowForDate("2026-10-20");
    await user.selectOptions(tuesday.getByLabelText("Platform"), "doordash");
    await user.type(tuesday.getByLabelText("Amount (AUD)"), "75.25");
    await user.type(tuesday.getByLabelText("Description (optional)"), "Dinner deliveries");
    expect(screen.getByRole("status")).toHaveTextContent("175.35");
    await user.click(screen.getByRole("button", { name: "Log 2 earnings" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/drive"));
    expect(createEarningsAction).toHaveBeenCalledExactlyOnceWith({
      earnings: [
        {
          platform: "uber",
          amountCents: 10010,
          currency: "AUD",
          date: new Date("2026-10-19"),
          description: "Uber earnings",
          notes: null,
        },
        {
          platform: "doordash",
          amountCents: 7525,
          currency: "AUD",
          date: new Date("2026-10-20"),
          description: "Dinner deliveries",
          notes: null,
        },
      ],
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("attaches server errors to the right row when blank amounts were skipped and keeps the draft", async () => {
    vi.mocked(createEarningsAction).mockResolvedValue({
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { "earnings.0.amountCents": ["Amount is too large."] },
    });
    const user = userEvent.setup();
    render(<DriveEarningsForm defaultCurrency="AUD" initialDate="2026-10-25" />);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-19" } });
    await user.click(screen.getByRole("button", { name: "Add earning" }));
    await user.type(rowForDate("2026-10-20").getByLabelText("Amount (AUD)"), "999.00");
    await user.click(screen.getByRole("button", { name: "Log 1 earning" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please fix the highlighted fields.",
    );
    const amount = rowForDate("2026-10-20").getByLabelText("Amount (AUD)");
    expect(amount).toHaveValue(999);
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(amount).toHaveAccessibleDescription("Amount is too large.");
    expect(rowForDate("2026-10-19").getByLabelText("Amount (AUD)")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("removes a row without losing another day's amount", async () => {
    const user = userEvent.setup();
    render(<DriveEarningsForm defaultCurrency="AUD" initialDate="2026-10-25" />);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-19" } });
    await user.click(screen.getByRole("button", { name: "Add earning" }));
    await user.type(rowForDate("2026-10-20").getByLabelText("Amount (AUD)"), "125");
    await user.click(rowForDate("2026-10-19").getByRole("button", { name: /remove earning/i }));
    expect(screen.getAllByLabelText("Date")).toHaveLength(1);
    expect(screen.getByLabelText("Amount (AUD)")).toHaveValue(125);
  });

  it("shows the check-before-retrying link when the server cannot confirm a database save", async () => {
    vi.mocked(createEarningsAction).mockResolvedValue({
      ok: false,
      unconfirmed: true,
      error:
        "We couldn’t confirm whether these earnings were saved. Check your earnings before trying again to avoid duplicates.",
    });
    const user = userEvent.setup();
    render(<DriveEarningsForm defaultCurrency="AUD" initialDate="2026-10-25" />);
    await user.type(screen.getByLabelText("Amount (AUD)"), "100");
    await user.click(screen.getByRole("button", { name: "Log 1 earning" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t confirm/i);
    expect(screen.getByRole("link", { name: /check earnings/i })).toHaveAttribute("href", "/drive");
    expect(screen.getByLabelText("Amount (AUD)")).toHaveValue(100);
    expect(push).not.toHaveBeenCalled();
  });

  it("locks the draft while saving and explains an unconfirmed response without losing amounts", async () => {
    let rejectSave!: (error: Error) => void;
    vi.mocked(createEarningsAction).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectSave = reject;
      }),
    );
    const user = userEvent.setup();
    render(<DriveEarningsForm defaultCurrency="AUD" initialDate="2026-10-25" />);
    await user.type(screen.getByLabelText("Amount (AUD)"), "100");
    await user.click(screen.getByRole("button", { name: "Log 1 earning" }));
    expect(screen.getByLabelText("Amount (AUD)")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add a week" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await act(async () => rejectSave(new Error("Connection lost")));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t confirm/i);
    expect(screen.getByRole("link", { name: /check earnings/i })).toHaveAttribute("href", "/drive");
    expect(screen.getByLabelText("Amount (AUD)")).toHaveValue(100);
    expect(screen.getByLabelText("Amount (AUD)")).toBeEnabled();
  });
});
