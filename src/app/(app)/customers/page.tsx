import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { loadCustomersPage } from "./actions";
import { CustomersTable } from "./customers-table";

export const metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const data = await loadCustomersPage(q);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground">
            Shared across Invoices, Quotes, Books, and Drive.
          </p>
        </div>
        {data.canManage ? (
          <Button asChild>
            <Link href="/customers/new">
              <Plus className="size-4" aria-hidden />
              New customer
            </Link>
          </Button>
        ) : null}
      </div>

      <form
        action="/customers"
        method="get"
        className="flex flex-wrap items-center gap-2"
        role="search"
      >
        <Input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name, email, or company"
          className="min-w-0 flex-1 sm:max-w-sm"
          aria-label="Search customers"
        />
        <Button type="submit" variant="outline">
          <Search className="size-4" aria-hidden />
          <span className="max-sm:sr-only">Search</span>
        </Button>
        {q ? (
          <Button asChild variant="ghost">
            <Link href="/customers">Clear</Link>
          </Button>
        ) : null}
      </form>

      <CustomersTable customers={data.customers} canManage={data.canManage} />
    </div>
  );
}
