import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { CustomerForm } from "@/features/customers/components/customers-form";
import { loadCustomer } from "@/features/customers/api/actions";

export const metadata = { title: "Edit customer" };

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { customer, canManage } = await loadCustomer(id);
  if (!customer) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/customers"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Back to customers
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Edit customer</h1>
      {!canManage ? (
        <p className="rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          You don&apos;t have permission to edit customers in this workspace.
        </p>
      ) : (
        <div className="max-w-xl">
          <CustomerForm mode="edit" customer={customer} />
        </div>
      )}
    </div>
  );
}
