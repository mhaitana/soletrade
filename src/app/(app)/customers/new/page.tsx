import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { CustomerForm } from "../customers-form";

export const metadata = { title: "New customer" };

export default function NewCustomerPage() {
  return (
    <div className="space-y-6">
      <Link
        href="/customers"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Back to customers
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">New customer</h1>
      <div className="max-w-xl">
        <CustomerForm mode="create" />
      </div>
    </div>
  );
}
