import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { BookForm } from "../books-form";
import { loadCustomersForBook } from "../actions";

export const metadata = { title: "New transaction" };

export default async function NewTransactionPage() {
  const data = await loadCustomersForBook();
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="books" />;
  if (!data.canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to record transactions.
      </p>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New transaction</h1>
        <p className="text-sm text-muted-foreground">Record income or an expense.</p>
      </div>
      <BookForm mode="create" customers={data.customers} defaultCurrency={data.defaultCurrency} />
    </div>
  );
}
