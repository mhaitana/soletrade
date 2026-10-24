import type { TaxPeriodId, WorkspaceId } from "@/types/ids";

export interface TaxPeriodRow {
  id: TaxPeriodId;
  workspaceId: WorkspaceId;
  fiscalYear: number;
  quarter: number;
  periodLabel: string;
  gstCollectedCents: number;
  gstPaidCents: number;
  netGstCents: number;
  lodgedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
