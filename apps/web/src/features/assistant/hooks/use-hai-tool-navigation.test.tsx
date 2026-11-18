import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import type { ComponentProps } from "react";
import {
  HaiToolPart,
  toolCallIdsOf,
  useHaiToolNavigation,
} from "@/features/assistant/hooks/use-hai-tool-navigation";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
beforeEach(() => push.mockClear());

type Part = ComponentProps<typeof HaiToolPart>["part"];

/** A tool part as the chat receives it; only the fields the card reads are needed. */
function part(name: string, overrides: Record<string, unknown>): Part {
  return {
    type: `tool-${name}`,
    toolCallId: `call-${name}`,
    input: {},
    ...overrides,
  } as unknown as Part;
}

describe("HaiToolPart activity cards", () => {
  it("shows a lookup in progress", () => {
    render(<HaiToolPart part={part("listInvoices", { state: "input-available" })} />);
    expect(screen.getByText("Looking up invoices…")).toBeInTheDocument();
  });

  it("shows what a lookup found and says when the list is partial", () => {
    render(
      <HaiToolPart
        part={part("listInvoices", {
          state: "output-available",
          output: { items: [], returned: 20, hasMore: true, href: "/invoices" },
        })}
      />,
    );
    expect(screen.getByText("Looked up invoices · 20+ found")).toBeInTheDocument();
    expect(screen.getByText(/this list is partial/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view/i })).toHaveAttribute("href", "/invoices");
  });

  it("shows a completed change with a link to the record", () => {
    render(
      <HaiToolPart
        part={part("sendInvoice", {
          state: "output-available",
          output: {
            id: "inv-1",
            sent: true,
            number: "INV-2026-0007",
            href: "/invoices/inv-1",
            recordLabel: "INV-2026-0007",
          },
        })}
      />,
    );
    expect(screen.getByText("Sent an invoice to the customer: INV-2026-0007")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open INV-2026-0007/i })).toHaveAttribute(
      "href",
      "/invoices/inv-1",
    );
  });

  it("says plainly when a change did not happen", () => {
    render(
      <HaiToolPart
        part={part("sendInvoice", {
          state: "output-available",
          output: { error: "Invoice INV-9 isn't a draft - it may already be sent." },
        })}
      />,
    );
    expect(screen.getByText("Nothing was changed.")).toBeInTheDocument();
    expect(screen.getByText(/isn't a draft/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows a thrown tool failure as an incomplete action", () => {
    render(
      <HaiToolPart part={part("createInvoice", { state: "output-error", errorText: "Boom" })} />,
    );
    expect(screen.getByText(/This action did not complete\./)).toBeInTheDocument();
  });

  it("never links off-site, whatever a tool result contains", () => {
    render(
      <HaiToolPart
        part={part("listCustomers", {
          state: "output-available",
          output: { items: [], returned: 1, hasMore: false, href: "https://evil.example" },
        })}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("treats a tool it does not know as an action, not a lookup", () => {
    render(<HaiToolPart part={part("brandNewTool", { state: "output-available", output: {} })} />);
    expect(screen.getByText("Completed an action")).toBeInTheDocument();
  });
});

describe("HaiToolPart approval cards", () => {
  const preview = {
    title: "Send invoice INV-7",
    details: ["To: Acme (ap@acme.test)", "Total: $1,100.00 AUD"],
    consequence: "Emails the invoice with a payment link.",
    caution: "sends-message" as const,
  };
  const waiting = part("sendInvoice", {
    state: "approval-requested",
    approval: { id: "ap-1" },
  });

  it("shows the server's preview and sends only the decision", async () => {
    const onDecide = vi.fn();
    render(<HaiToolPart part={waiting} preview={preview} onDecide={onDecide} />);
    const card = screen.getByRole("group", { name: "Approval needed: Send invoice INV-7" });
    expect(card).toHaveTextContent("To: Acme (ap@acme.test)");
    expect(card).toHaveTextContent("Total: $1,100.00 AUD");
    expect(card).toHaveTextContent("Emails the invoice with a payment link.");
    expect(card).toHaveTextContent("This sends an email to someone outside your workspace.");

    await userEvent.click(screen.getByRole("button", { name: "Approve: Send invoice INV-7" }));
    expect(onDecide).toHaveBeenCalledWith("ap-1", true);
    await userEvent.click(screen.getByRole("button", { name: "Decline: Send invoice INV-7" }));
    expect(onDecide).toHaveBeenLastCalledWith("ap-1", false);
  });

  it("shows no buttons where the card cannot take a decision", () => {
    render(<HaiToolPart part={waiting} preview={preview} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for your approval.")).toBeInTheDocument();
  });

  it("disables the buttons while a request is in flight", () => {
    render(<HaiToolPart part={waiting} preview={preview} onDecide={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: /^Approve/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Decline/ })).toBeDisabled();
  });

  it("says when a declined or refused change was not done, with the reason", () => {
    const { unmount } = render(
      <HaiToolPart
        part={part("sendInvoice", {
          state: "approval-responded",
          approval: { id: "ap-1", approved: false },
        })}
        preview={preview}
      />,
    );
    expect(screen.getByText("Not done: Send invoice INV-7")).toBeInTheDocument();
    expect(screen.getByText("You declined this change.")).toBeInTheDocument();
    unmount();

    render(
      <HaiToolPart
        part={part("createCustomer", {
          state: "output-denied",
          approval: { id: "ap-2", approved: false, reason: "Changes are turned off." },
        })}
      />,
    );
    expect(screen.getByText("Changes are turned off.")).toBeInTheDocument();
  });

  it("shows an approved change as running until its result arrives", () => {
    render(
      <HaiToolPart
        part={part("sendInvoice", {
          state: "approval-responded",
          approval: { id: "ap-1", approved: true },
        })}
        preview={preview}
      />,
    );
    expect(screen.getByText(/^Approved\./)).toBeInTheDocument();
  });
});

describe("useHaiToolNavigation", () => {
  const navigated = {
    id: "m1",
    role: "assistant" as const,
    parts: [
      {
        type: "tool-navigateWorkspace",
        toolCallId: "nav-1",
        state: "output-available",
        input: {},
        output: {
          ok: true,
          directive: {
            id: "00000000-0000-4000-8000-000000000001",
            destination: "invoices",
            label: "Invoices",
            href: "/invoices",
          },
        },
      },
    ],
  } as unknown as UIMessage;

  it("opens the page a new navigation result points to, once", () => {
    const { rerender } = renderHook(({ messages }) => useHaiToolNavigation(messages), {
      initialProps: { messages: [navigated] },
    });
    rerender({ messages: [navigated] });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/invoices");
  });

  it("does not navigate again when a stored conversation is reopened", () => {
    const settled = toolCallIdsOf([navigated]);
    renderHook(() => useHaiToolNavigation([navigated], settled));
    expect(push).not.toHaveBeenCalled();
  });
});
