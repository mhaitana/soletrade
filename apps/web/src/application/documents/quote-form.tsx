"use client";

import type { ComponentProps } from "react";
import { QuoteForm as FeatureQuoteForm } from "@/features/quotes/components/quotes-form";
import { CustomerCreateDialog } from "@/features/customers/components/customer-create-dialog";

/** Compose customer creation with the quote editor at the application boundary. */
export function QuoteForm(
  props: Omit<ComponentProps<typeof FeatureQuoteForm>, "renderCustomerCreate">,
) {
  return (
    <FeatureQuoteForm
      {...props}
      renderCustomerCreate={(onCreated) => <CustomerCreateDialog onCreated={onCreated} />}
    />
  );
}
