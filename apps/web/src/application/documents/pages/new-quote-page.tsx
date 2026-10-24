import { ModuleNotInstalledCard } from "@/components/module-not-installed-card";
import { QuoteForm } from "@/application/documents/quote-form";
import { loadCustomersForQuote } from "@/features/quotes/api/actions";

export const metadata = { title: "New quote" };

export default async function NewQuotePage() {
  const data = await loadCustomersForQuote();
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="quotes" />;
  if (!data.canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to create quotes.
      </p>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New quote</h1>
        <p className="text-sm text-muted-foreground">
          Drafts can be edited until they are sent to the customer.
        </p>
      </div>
      <QuoteForm mode="create" customers={data.customers} defaultCurrency={data.defaultCurrency} />
    </div>
  );
}
