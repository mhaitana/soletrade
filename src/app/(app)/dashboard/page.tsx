import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Skeleton } from "@/shared/ui/skeleton";
import { BookOpen, Car, FileText, Receipt, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const modules: { name: string; desc: string; icon: LucideIcon }[] = [
  { name: "Invoices", desc: "Bill clients and accept card payments.", icon: Receipt },
  { name: "Books", desc: "Track income, expenses, and receipts.", icon: BookOpen },
  { name: "Drive", desc: "Log gig earnings and mileage.", icon: Car },
  { name: "Quotes", desc: "Send proposals and convert to invoices.", icon: FileText },
];

const checklist = [
  "Create your workspace",
  "Enable your first module",
  "Add a customer",
  "Send your first invoice or quote",
];

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome to your workspace. Enable a module to get started.
        </p>
      </div>

      {/* Onboarding checklist */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-primary" aria-hidden />
            Onboarding
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {checklist.map((step, i) => (
            <div key={step} className="flex items-center gap-3 text-sm">
              <span
                className="grid size-5 place-items-center rounded-full border border-border text-xs text-muted-foreground"
                aria-hidden
              >
                {i + 1}
              </span>
              <span className="text-foreground">{step}</span>
              <Badge variant="outline" className="ml-auto text-muted-foreground">
                Pending
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Module cards — empty state prompts to enable */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Modules</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {modules.map((m) => {
            const Icon = m.icon;
            return (
              <Card key={m.name} className="transition-colors hover:border-primary/40">
                <CardHeader>
                  <Icon className="size-5 text-primary" aria-hidden />
                  <CardTitle className="mt-3 text-sm">soletrade {m.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">{m.desc}</p>
                  <p className="mt-4 text-xs font-medium text-brand-blue">Enable module →</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Loading skeleton example — replaced by real summaries in Phase 9 */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Recent activity</h2>
        <Card>
          <CardContent className="space-y-3 py-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
