import Link from "next/link";
import { ModuleNotInstalledCard } from "@/components/module-not-installed-card";
import { Button } from "@/components/ui/button";
import { BookForm } from "@/features/books/components/books-form";
import { loadTransactionForEdit } from "@/features/books/api/actions";

export const metadata = { title: "Edit transaction" };

export default async function EditTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadTransactionForEdit(id);
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="books" />;
  if (!data.transaction) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Transaction not found.</p>
        <Button asChild variant="outline">
          <Link href="/books">Back to books</Link>
        </Button>
      </div>
    );
  }
  if (data.source) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Synced transaction</h1>
        <p className="text-sm text-muted-foreground">
          This entry is managed by its {data.source.label.toLowerCase()}. Edit the source record and
          Books will update automatically.
        </p>
        <Button asChild>
          <Link href={data.source.href}>Open {data.source.label}</Link>
        </Button>
      </div>
    );
  }
  if (!data.canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to edit transactions.
      </p>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit transaction</h1>
        <p className="text-sm text-muted-foreground">Update the details of this transaction.</p>
      </div>
      <BookForm
        mode="edit"
        tx={data.transaction}
        customers={data.customers}
        defaultCurrency={data.defaultCurrency}
      />
    </div>
  );
}
