import type { ConsolidatedIncome } from "./business-income";
export interface MobileHomeOverview {
  workspaceId: string;
  period: string;
  periodLabel: string;
  currency: string;
  totalIncome: ConsolidatedIncome;
  kpis: { id: string; label: string; cents: number }[];
  attention: {
    id: string;
    title: string;
    count: number;
    resource: "invoices" | "quotes" | "books/receipts";
    status: string;
  }[];
}
