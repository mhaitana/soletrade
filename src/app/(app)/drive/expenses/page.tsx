import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { formatCents } from "@/platform/billing/pricing";
import { formatDate } from "@/shared/utils/format-date";
import { type VehicleExpenseType } from "@/server/db/enums";
import { loadExpensesPage } from "./actions";
import { ExpenseForm } from "./expense-form";

export const metadata = { title: "Vehicle expenses" };
export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<VehicleExpenseType, string> = {
  fuel: "Fuel",
  maintenance: "Maintenance",
  insurance: "Insurance",
  registration: "Registration",
  other: "Other",
};

const TYPE_BADGE: Record<VehicleExpenseType, string> = {
  fuel: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  maintenance: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  insurance: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
  registration: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  other: "bg-muted text-muted-foreground",
};

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ vehicle?: string | string[] }>;
}) {
  const sp = await searchParams;
  const rawVehicle = typeof sp.vehicle === "string" ? sp.vehicle : undefined;
  const data = await loadExpensesPage({ vehicleId: rawVehicle });
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="drive" />;

  const filterVehicle = data.vehicleFilter
    ? data.vehicles.find((v) => v.id === data.vehicleFilter)
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Vehicle expenses</h1>
        <p className="text-sm text-muted-foreground">
          Log fuel, maintenance, insurance and other running costs against a vehicle.
          {filterVehicle ? (
            <>
              {" "}
              Filtering by <span className="font-medium text-foreground">{filterVehicle.name}</span>
              .
            </>
          ) : null}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {data.canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Log an expense</CardTitle>
            </CardHeader>
            <CardContent>
              {data.vehicles.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Add a vehicle before you can log an expense.
                  </p>
                  <Link href="/drive/vehicles/new" className="text-sm text-primary hover:underline">
                    Add your first vehicle
                  </Link>
                </div>
              ) : (
                <ExpenseForm
                  mode="create"
                  vehicles={data.vehicles}
                  defaultVehicleId={data.vehicleFilter}
                />
              )}
            </CardContent>
          </Card>
        ) : null}

        <Card className={data.canManage ? "" : "lg:col-span-2"}>
          <CardHeader>
            <CardTitle>
              Recent expenses
              {filterVehicle ? ` · ${filterVehicle.name}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.expenses.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {filterVehicle
                  ? "No expenses logged for this vehicle yet."
                  : "No vehicle expenses logged yet."}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Date
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Type
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Vehicle
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Description
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.expenses.map(({ expense, vehicle }) => (
                      <tr key={expense.id} className="transition-colors hover:bg-muted/40">
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDate(expense.date)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${TYPE_BADGE[expense.type]}`}
                          >
                            {TYPE_LABEL[expense.type]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {vehicle ? vehicle.name : "-"}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/drive/expenses/${expense.id}/edit`}
                            className="font-medium text-foreground hover:underline"
                          >
                            {expense.description}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                          {formatCents(expense.amountCents, expense.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
