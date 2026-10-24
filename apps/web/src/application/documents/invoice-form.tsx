"use client";

import type { ComponentProps } from "react";
import { InvoiceForm as FeatureInvoiceForm } from "@/features/invoices/components/invoices-form";
import { CustomerCreateDialog } from "@/features/customers/components/customer-create-dialog";

/** Compose customer creation with the invoice editor at the application boundary. */
export function InvoiceForm(
  props: Omit<ComponentProps<typeof FeatureInvoiceForm>, "renderCustomerCreate">,
) {
  return (
    <FeatureInvoiceForm
      {...props}
      renderCustomerCreate={(onCreated) => <CustomerCreateDialog onCreated={onCreated} />}
    />
  );
}
