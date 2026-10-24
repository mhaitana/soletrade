import type { WorkspaceRole } from "@/lib/domain/database-enums";
import type { UserId, WorkspaceId } from "@/types/ids";
import type { PaymentMethods } from "@/types/payment-methods";

export interface WorkspaceMembership {
  workspaceId: WorkspaceId;
  name: string;
  slug: string;
  role: WorkspaceRole;
}

export interface WorkspaceRow {
  id: WorkspaceId;
  name: string;
  slug: string;
  ownerId: UserId;
  defaultCurrency: string;
  invoicePrefix: string;
  quotePrefix: string;
  timezone: string;
  fyStartMonth: number;
  paymentMethods: PaymentMethods;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface WorkspaceUpdateInput {
  name: string;
  defaultCurrency: string;
  invoicePrefix: string;
  quotePrefix: string;
  timezone: string;
  /** Financial-year start month, 1–12 (1 = January, 7 = July). */
  fyStartMonth: number;
  /** Customer-facing payment methods (jsonb array). Empty array is stored as `[]`. */
  paymentMethods: PaymentMethods;
}
