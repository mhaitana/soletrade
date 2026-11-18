import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CUSTOMER_COMBOBOX_LIMIT,
  CustomerCombobox,
  matchCustomers,
} from "@/components/customer-combobox";
import type { PickerCustomer } from "@/types/customer-picker";

beforeAll(() => {
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

const many: PickerCustomer[] = Array.from({ length: 120 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  name: `Customer ${String(i).padStart(3, "0")}`,
  email: `c${i}@example.test`,
  company: i === 117 ? "Harbour Plumbing" : null,
}));

function Harness(props: {
  customers: PickerCustomer[];
  noneLabel?: string;
  initial?: string;
  unavailableReason?: (c: PickerCustomer) => string | null;
}) {
  const [value, setValue] = useState(props.initial ?? "");
  return (
    <form aria-label="test form">
      <label htmlFor="customerId">Customer</label>
      <CustomerCombobox
        id="customerId"
        name="customerId"
        customers={props.customers}
        value={value}
        onValueChange={setValue}
        noneLabel={props.noneLabel}
        unavailableReason={props.unavailableReason}
      />
    </form>
  );
}

const hiddenValue = () =>
  (document.querySelector('input[name="customerId"]') as HTMLInputElement).value;

describe("CustomerCombobox", () => {
  it("matches every word against name, company and email", () => {
    expect(matchCustomers(many, "harbour plumb").map((c) => c.id)).toEqual([many[117]!.id]);
    expect(matchCustomers(many, "c42@example")).toHaveLength(1);
    expect(matchCustomers(many, "   ")).toHaveLength(many.length);
  });

  it("reaches a customer far past the first rows by searching", async () => {
    const user = userEvent.setup();
    render(<Harness customers={many} />);

    await user.click(screen.getByRole("combobox", { name: "Customer" }));
    expect(screen.getAllByRole("option")).toHaveLength(CUSTOMER_COMBOBOX_LIMIT);
    expect(
      screen.getByText(`Showing ${CUSTOMER_COMBOBOX_LIMIT} of 120.`, { exact: false }),
    ).toBeTruthy();

    await user.type(screen.getByLabelText("Search customers"), "harbour");
    await user.click(screen.getByRole("option", { name: /Customer 117/ }));

    expect(hiddenValue()).toBe(many[117]!.id);
    expect(screen.getByRole("combobox", { name: "Customer" })).toHaveTextContent(
      "Customer 117 · Harbour Plumbing",
    );
  });

  it("shows unavailable customers but does not let them be picked", async () => {
    const user = userEvent.setup();
    const customers = [
      { id: "a", name: "No Email Co", email: null, company: null },
      { id: "b", name: "Has Email Co", email: "b@example.test", company: null },
    ];
    render(
      <Harness
        customers={customers}
        unavailableReason={(c) => (c.email ? null : "no email - add one")}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Customer" }));
    const [blocked, allowed] = screen.getAllByRole("option");
    expect(blocked).toHaveTextContent("No Email Co (no email - add one)");
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    expect(allowed).toHaveAttribute("aria-disabled", "false");
    await user.click(blocked!);
    expect(hiddenValue()).toBe("");
  });

  it("offers a none option that clears the choice", async () => {
    const user = userEvent.setup();
    render(<Harness customers={many.slice(0, 3)} noneLabel="None" initial={many[1]!.id} />);

    const trigger = screen.getByRole("combobox", { name: "Customer" });
    expect(trigger).toHaveTextContent("Customer 001");
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "None" }));
    expect(hiddenValue()).toBe("");
    expect(trigger).toHaveTextContent("None");
  });

  it("says when the saved customer is no longer in the list", () => {
    render(<Harness customers={many.slice(0, 3)} initial="deleted-customer" />);
    expect(screen.getByRole("combobox", { name: "Customer" })).toHaveTextContent(
      "Customer not in this list",
    );
  });
});
