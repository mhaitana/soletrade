import Link from "next/link";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { Button } from "@/shared/ui/button";
import { ExpenseForm } from "../../expense-form";
import { ExpenseDeleteButton } from "../../expense-delete-button";
import { loadExpenseForEdit } from "../../actions";

export const metadata = { title: "Edit expense" };
export const dynamic = "force-dynamic";

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadExpenseForEdit(id);
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="drive" />;
  if (!data.canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to edit vehicle expenses.
      </p>
    );
  }
  if (!data.expense) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Expense not found.</p>
        <Button asChild variant="outline">
          <Link href="/drive/expenses">Back to expenses</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit expense</h1>
        <p className="text-sm text-muted-foreground">Update the details of this vehicle expense.</p>
      </div>
      <ExpenseForm mode="edit" expense={data.expense} vehicles={data.vehicles} />
      <div className="border-t border-border pt-4">
        <ExpenseDeleteButton id={data.expense.id} />
      </div>
    </div>
  );
}
