import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { InvoiceForm } from "../invoices-form";
import { loadCustomersForInvoice } from "../actions";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage() {
  const data = await loadCustomersForInvoice();
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="invoices" />;
  if (!data.canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to create invoices.
      </p>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New invoice</h1>
        <p className="text-sm text-muted-foreground">Drafts can be edited until they are sent.</p>
      </div>
      <InvoiceForm
        mode="create"
        customers={data.customers}
        workspacePaymentMethods={data.workspacePaymentMethods}
        defaultCurrency={data.defaultCurrency}
      />
    </div>
  );
}
