import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@/features/search/components/command-palette";
import type { SearchResultGroup } from "@/types/search";

const push = vi.fn();
const fetchMock = vi.fn<typeof fetch>();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function results(label: string): SearchResultGroup[] {
  return [
    {
      module: "books",
      results: [{ module: "books", id: "tx-1", label, sublabel: "$25.00", href: "/books/tx-1" }],
    },
  ];
}

function response(groups: SearchResultGroup[]) {
  return new Response(JSON.stringify({ groups }), { status: 200 });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function changeQuery(value: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value } });
}

async function finishDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  push.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CommandPalette", () => {
  it("updates navigation when a role loses audit access", () => {
    const installedModules: [] = [];
    const { rerender } = render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        installedModules={installedModules}
        role="owner"
      />,
    );
    expect(screen.getByRole("option", { name: "Audit log" })).toBeInTheDocument();

    rerender(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        installedModules={installedModules}
        role="readonly"
      />,
    );

    expect(screen.queryByRole("option", { name: "Audit log" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("reaches sub-pages that have no sidebar entry once the query matches them", () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        installedModules={["books", "drive"]}
        role="owner"
      />,
    );
    // Not listed until asked for, so the default list stays short.
    expect(screen.queryByRole("option", { name: "GST / BAS" })).not.toBeInTheDocument();

    changeQuery("gst");
    fireEvent.click(screen.getByRole("option", { name: "GST / BAS" }));
    expect(push).toHaveBeenCalledWith("/books/tax");
  });

  it("hides module sub-pages when the module is not installed", () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    render(
      <CommandPalette open onOpenChange={vi.fn()} installedModules={["invoices"]} role="owner" />,
    );
    changeQuery("receipts");
    expect(screen.queryByRole("option", { name: "Receipts" })).not.toBeInTheDocument();
  });

  it("offers the create actions the role is allowed to use", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        installedModules={["invoices", "books"]}
        role="owner"
      />,
    );
    expect(screen.getByRole("option", { name: /New invoice/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /New transaction/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /New customer/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /New quote/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: /New invoice/ }));
    expect(push).toHaveBeenCalledWith("/invoices/new");
    expect(onOpenChange).toHaveBeenCalledWith(false);

    rerender(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        installedModules={["invoices", "books"]}
        role="readonly"
      />,
    );
    expect(screen.queryByRole("option", { name: /New invoice/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /New customer/ })).not.toBeInTheDocument();
  });

  it("keeps server matches whose searchable fields are absent from the display label", async () => {
    fetchMock.mockResolvedValue(response(results("Airport parking")));
    render(
      <CommandPalette open onOpenChange={vi.fn()} installedModules={["books"]} role="owner" />,
    );

    // The server can match a customer's company or a Drive note, neither of which
    // needs to appear in the result's display text.
    changeQuery("Acme");
    await finishDebounce();

    const match = screen.getByRole("option", { name: /Airport parking/ });
    expect(match).toBeVisible();
    expect(screen.queryByRole("option", { name: "Dashboard" })).not.toBeInTheDocument();
    fireEvent.click(match);
    expect(push).toHaveBeenCalledWith("/books/tx-1");
  });

  it("hides the previous query's results during the next debounce", async () => {
    fetchMock.mockResolvedValue(response(results("Acme parking")));
    render(
      <CommandPalette open onOpenChange={vi.fn()} installedModules={["books"]} role="owner" />,
    );
    changeQuery("ac");
    await finishDebounce();
    expect(screen.getByText("Acme parking")).toBeVisible();

    changeQuery("acm");

    expect(screen.queryByText("Acme parking")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/searching/i);
    expect(screen.queryByText("No results.")).not.toBeInTheDocument();
  });

  it("ignores an obsolete response while the latest query is still loading", async () => {
    const previous = deferredResponse();
    const latest = deferredResponse();
    fetchMock.mockReturnValueOnce(previous.promise).mockReturnValueOnce(latest.promise);
    render(
      <CommandPalette open onOpenChange={vi.fn()} installedModules={["books"]} role="owner" />,
    );
    changeQuery("ac");
    await finishDebounce();
    changeQuery("acm");
    await finishDebounce();

    // This transport deliberately resolves after abort to cover responses already
    // being decoded when the user changes the query.
    await act(async () => previous.resolve(response(results("Acme previous"))));
    expect(screen.queryByText("Acme previous")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/searching/i);

    await act(async () => latest.resolve(response(results("Acme latest"))));
    expect(screen.getByRole("option", { name: /Acme latest/ })).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each(["http", "network"])("offers a working retry after a %s failure", async (kind) => {
    if (kind === "http") fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    else fetchMock.mockRejectedValueOnce(new Error("Offline"));
    fetchMock.mockResolvedValueOnce(response(results("Acme parking")));
    render(
      <CommandPalette open onOpenChange={vi.fn()} installedModules={["books"]} role="owner" />,
    );
    changeQuery("acme");
    await finishDebounce();

    expect(screen.getByRole("alert")).toHaveTextContent(/search/i);
    expect(screen.queryByText("No results.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await finishDebounce();

    expect(screen.getByRole("option", { name: /Acme parking/ })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("retries with Enter without activating a matching navigation option", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(response(results("Customer receipt")));
    render(
      <CommandPalette open onOpenChange={vi.fn()} installedModules={["books"]} role="owner" />,
    );
    changeQuery("cust");
    await screen.findByRole("alert");

    expect(screen.getByRole("option", { name: "Customers" })).toBeVisible();
    screen.getByRole("button", { name: /try again/i }).focus();
    await user.keyboard("{Enter}");

    expect(push).not.toHaveBeenCalled();
    expect(await screen.findByRole("option", { name: /Customer receipt/ })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("selects records with identical display text independently using the keyboard", async () => {
    fetchMock.mockResolvedValue(
      response([
        {
          module: "books",
          results: [
            {
              module: "books",
              id: "tx-1",
              label: "Airport parking",
              sublabel: "$25.00",
              href: "/books/tx-1",
            },
            {
              module: "books",
              id: "tx-2",
              label: "Airport parking",
              sublabel: "$25.00",
              href: "/books/tx-2",
            },
          ],
        },
      ]),
    );
    render(
      <CommandPalette open onOpenChange={vi.fn()} installedModules={["books"]} role="owner" />,
    );
    changeQuery("Acme");
    await finishDebounce();

    expect(screen.getAllByRole("option", { selected: true })).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    expect(push).toHaveBeenCalledWith("/books/tx-2");
  });

  it("puts what was typed to hAI when asked, after the records that matched", async () => {
    fetchMock.mockResolvedValue(
      response([
        {
          module: "books",
          results: [{ module: "books", id: "tx-1", label: "Airport parking", href: "/books/tx-1" }],
        },
      ]),
    );
    const asked: unknown[] = [];
    const listen = (event: Event) => asked.push((event as CustomEvent).detail);
    window.addEventListener("hai:ask", listen);
    const onOpenChange = vi.fn();
    render(
      <CommandPalette open onOpenChange={onOpenChange} installedModules={["books"]} role="owner" />,
    );
    changeQuery("who owes me money");
    // Not offered while the search is still running: it would be the only entry, and Enter
    // would send the question instead of opening the first match.
    expect(screen.queryByRole("option", { name: /Ask hAI/ })).not.toBeInTheDocument();
    await finishDebounce();

    const options = screen.getAllByRole("option");
    expect(options.at(-1)).toHaveTextContent("Ask hAI: “who owes me money”");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.click(options.at(-1)!);
    expect(asked).toEqual([{ question: "who owes me money", send: true }]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(push).not.toHaveBeenCalled();
    window.removeEventListener("hai:ask", listen);
  });
});
