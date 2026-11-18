"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { PickerCustomer } from "@/types/customer-picker";

/** How many matches the list renders at once; typing narrows the rest. */
export const CUSTOMER_COMBOBOX_LIMIT = 50;

/** Every search word must appear in the customer's name, company or email. */
export function matchCustomers(
  customers: readonly PickerCustomer[],
  query: string,
): PickerCustomer[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...customers];
  return customers.filter((customer) => {
    const haystack = [customer.name, customer.company, customer.email]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * A searchable customer field for document and transaction forms. It replaces a native
 * select that only listed the first 100 customers: the form passes every customer and the
 * list filters as the user types, rendering at most {@link CUSTOMER_COMBOBOX_LIMIT} rows.
 * A hidden input keeps the chosen id in the form under `name`.
 */
export function CustomerCombobox({
  id,
  name,
  customers,
  value,
  onValueChange,
  placeholder = "Pick a customer…",
  noneLabel,
  unavailableReason,
  invalid,
  describedBy,
}: {
  id: string;
  name: string;
  customers: readonly PickerCustomer[];
  value: string;
  onValueChange: (customerId: string) => void;
  placeholder?: string;
  /** When set, the list starts with an option that clears the choice. */
  noneLabel?: string;
  /** A reason the customer cannot be picked, such as a missing email; null if allowed. */
  unavailableReason?: (customer: PickerCustomer) => string | null;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = customers.find((customer) => customer.id === value) ?? null;
  const matches = useMemo(() => matchCustomers(customers, query), [customers, query]);
  const shown = matches.slice(0, CUSTOMER_COMBOBOX_LIMIT);
  const listId = `${id}-options`;

  const choose = (customerId: string) => {
    onValueChange(customerId);
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 py-2 text-left text-base shadow-xs outline-none transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive max-md:min-h-11 md:text-sm dark:bg-input/20"
          >
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected ? (
                <>
                  {selected.name}
                  {selected.company ? (
                    <span className="text-muted-foreground"> · {selected.company}</span>
                  ) : null}
                </>
              ) : value ? (
                "Customer not in this list"
              ) : (
                (noneLabel ?? placeholder)
              )}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) min-w-72 p-0"
          onOpenAutoFocus={(event) => {
            // Let cmdk focus its own search input instead of the first item.
            event.preventDefault();
            const input = (event.currentTarget as HTMLElement | null)?.querySelector("input");
            input?.focus();
          }}
        >
          <Command shouldFilter={false} label="Customers">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search name, company or email"
              aria-label="Search customers"
            />
            <CommandList id={listId}>
              <CommandEmpty>No customers match.</CommandEmpty>
              <CommandGroup>
                {noneLabel && !query ? (
                  <CommandItem value="__none__" onSelect={() => choose("")}>
                    <Check
                      className={cn("size-4", value === "" ? "opacity-100" : "opacity-0")}
                      aria-hidden
                    />
                    {noneLabel}
                  </CommandItem>
                ) : null}
                {shown.map((customer) => {
                  const reason = unavailableReason?.(customer) ?? null;
                  return (
                    <CommandItem
                      key={customer.id}
                      value={customer.id}
                      disabled={reason !== null}
                      onSelect={() => choose(customer.id)}
                    >
                      <Check
                        className={cn(
                          "size-4",
                          value === customer.id ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {customer.name}
                        {customer.company ? (
                          <span className="text-muted-foreground"> · {customer.company}</span>
                        ) : null}
                        {reason ? <span className="text-muted-foreground"> ({reason})</span> : null}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              {matches.length > shown.length ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Showing {shown.length} of {matches.length}. Keep typing to narrow the list.
                </p>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <input type="hidden" name={name} value={value} />
    </>
  );
}
