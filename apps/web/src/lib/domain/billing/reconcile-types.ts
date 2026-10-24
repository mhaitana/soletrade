import type { ModuleKey } from "@/config/modules";
import type { Role } from "@/lib/domain/billing/pricing";

export interface CheckoutItem {
  moduleKey: ModuleKey;
  role: Role;
  itemId: string;
}
