import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setDigestFrequencyAction, type DigestSettingsData } from "@/features/assistant/api/digest";
import { DigestCard } from "@/features/assistant/components/digest-card";

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));
vi.mock("@/features/assistant/api/digest", () => ({ setDigestFrequencyAction: vi.fn() }));

const initial: DigestSettingsData = {
  frequency: "off",
  workspaceName: "Acme Plumbing",
  timezone: "Australia/Sydney",
  email: "member@example.test",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DigestCard", () => {
  it("starts on Off and says what is sent, where and when", () => {
    render(<DigestCard initial={initial} />);

    expect(screen.getByText("Briefing digest")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^Off/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Daily/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /^Weekly/ })).not.toBeChecked();
    const description = screen.getByText(/A short summary of what needs your attention/);
    expect(description).toHaveTextContent("Acme Plumbing");
    expect(description).toHaveTextContent("member@example.test");
    expect(description).toHaveTextContent("after 7:00 am (Australia/Sydney time)");
    expect(description).toHaveTextContent("never when there is nothing to report");
    // Nothing to save until the choice changes.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows the member's saved choice", () => {
    render(<DigestCard initial={{ ...initial, frequency: "weekly" }} />);

    expect(screen.getByRole("radio", { name: /^Weekly/ })).toBeChecked();
  });

  it("saves the chosen frequency and confirms it", async () => {
    vi.mocked(setDigestFrequencyAction).mockResolvedValue({ ok: true, frequency: "daily" });
    const user = userEvent.setup();
    render(<DigestCard initial={initial} />);

    await user.click(screen.getByRole("radio", { name: /^Daily/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Briefing digest saved"));
    expect(setDigestFrequencyAction).toHaveBeenCalledWith({ frequency: "daily" });
    expect(screen.getByRole("radio", { name: /^Daily/ })).toBeChecked();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
  });

  it("confirms turning the digest off in its own words", async () => {
    vi.mocked(setDigestFrequencyAction).mockResolvedValue({ ok: true, frequency: "off" });
    const user = userEvent.setup();
    render(<DigestCard initial={{ ...initial, frequency: "daily" }} />);

    await user.click(screen.getByRole("radio", { name: /^Off/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Briefing digest turned off"));
    expect(setDigestFrequencyAction).toHaveBeenCalledWith({ frequency: "off" });
  });

  it("shows the error and keeps the choice unsaved when saving fails", async () => {
    vi.mocked(setDigestFrequencyAction).mockResolvedValue({
      ok: false,
      error: "Your choice could not be saved. Try again.",
    });
    const user = userEvent.setup();
    render(<DigestCard initial={initial} />);

    await user.click(screen.getByRole("radio", { name: /^Weekly/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your choice could not be saved. Try again.",
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    // Still different from what is saved, so it can be tried again.
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});
