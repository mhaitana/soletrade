import Link from "next/link";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { Button } from "@/shared/ui/button";
import { BookForm } from "../../books-form";
import { loadTransactionForEdit } from "../../actions";

export const metadata = { title: "Edit transaction" };

export default async function EditTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadTransactionForEdit(id);
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="books" />;
  if (!data.canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to edit transactions.
      </p>
    );
  }
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
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit transaction</h1>
        <p className="text-sm text-muted-foreground">Update the details of this transaction.</p>
      </div>
      <BookForm mode="edit" tx={data.transaction} customers={data.customers} />
    </div>
  );
}
