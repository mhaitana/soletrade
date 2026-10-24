import type { CancelOption } from "@/lib/domain/billing/cancellation";
import type { ModuleKey } from "@/config/modules";

export interface AddModuleResult {
  stripeSubscriptionItemId: string;
  role: "standalone" | "addon";
  becameAnchor: boolean;
  demotedItemId?: string;
}

export interface RemoveModuleResult {
  deletedItemId: string | null;
  promotedItemId?: string;
  promotedModuleKey?: ModuleKey;
  /** Cents moved by the cancellation (ledger credit or card refund; 0 for keep / no billing). */
  refundCents: number;
  /** Which cancellation option was executed. */
  option: CancelOption;
  /** Stripe refund id when a card refund was issued, else null. */
  stripeRefundId: string | null;
  /** Effective timestamp for keep-until-end (the period end); null otherwise. */
  effectiveAt: Date | null;
}
