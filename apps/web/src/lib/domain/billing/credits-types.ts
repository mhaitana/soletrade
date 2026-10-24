import type { CreditLedgerEntryId, UserId, WorkspaceId } from "@/types/ids";
import type { ModuleKey } from "@/config/modules";

export interface CreditEntryInput {
  amountCents: number;
  currency?: string;
  reason: string;
  moduleKey?: ModuleKey;
  actorUserId?: UserId;
  stripeInvoiceId?: string;
  stripeRefundId?: string;
  /** Optional expiry - only meaningful for grant/promotion rows. */
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface CreditLedgerRow {
  id: CreditLedgerEntryId;
  workspaceId: WorkspaceId;
  entryType: "grant" | "consumption" | "refund" | "adjustment" | "promotion" | "expired";
  amountCents: number;
  currency: string;
  reason: string;
  moduleKey: ModuleKey | null;
  actorUserId: UserId | null;
  stripeInvoiceId: string | null;
  stripeRefundId: string | null;
  expiresAt: Date | null;
  /** PostgREST returns jsonb as the generated `Json` union; callers cast at the use site. */
  metadata: unknown;
  createdAt: Date;
}

export interface CreditEntryResult {
  entryId: CreditLedgerEntryId;
  /** Balance after this entry (derived: balanceBefore + amountCents). */
  balanceCents: number;
}
