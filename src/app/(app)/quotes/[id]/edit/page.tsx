import Link from "next/link";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { Button } from "@/shared/ui/button";
import { QuoteForm } from "../../quotes-form";
import { loadQuoteForEdit } from "../../actions";

export const metadata = { title: "Edit quote" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadQuoteForEdit(id);
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="quotes" />;
  if (!data.canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to edit quotes.
      </p>
    );
  }
  if (!data.quote) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Quote not found.</p>
        <Button asChild variant="outline">
          <Link href="/quotes">Back to quotes</Link>
        </Button>
      </div>
    );
  }
  if (data.quote.status !== "draft") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Only draft quotes can be edited. This quote is <strong>{data.quote.status}</strong>.
        </p>
        <Button asChild variant="outline">
          <Link href={`/quotes/${data.quote.id}`}>Back to quote</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Edit{" "}
          <span className="font-mono text-base text-muted-foreground">{data.quote.number}</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Save before sending - sent quotes are locked.
        </p>
      </div>
      <QuoteForm
        mode="edit"
        quote={data.quote}
        customers={data.customers}
        defaultCurrency={data.defaultCurrency}
      />
    </div>
  );
}
