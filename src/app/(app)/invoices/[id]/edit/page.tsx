import Link from "next/link";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { Button } from "@/shared/ui/button";
import { InvoiceForm } from "../../invoices-form";
import { loadInvoiceForEdit } from "../../actions";

export const metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadInvoiceForEdit(id);
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="invoices" />;
  if (!data.canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to edit invoices.
      </p>
    );
  }
  if (!data.invoice) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Invoice not found.</p>
        <Button asChild variant="outline">
          <Link href="/invoices">Back to invoices</Link>
        </Button>
      </div>
    );
  }
  if (data.invoice.status !== "draft") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Only draft invoices can be edited. This invoice is <strong>{data.invoice.status}</strong>.
        </p>
        <Button asChild variant="outline">
          <Link href={`/invoices/${data.invoice.id}`}>Back to invoice</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Edit{" "}
          <span className="font-mono text-base text-muted-foreground">{data.invoice.number}</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Save before sending - sent invoices are locked.
        </p>
      </div>
      <InvoiceForm mode="edit" invoice={data.invoice} customers={data.customers} />
    </div>
  );
}
