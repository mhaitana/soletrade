import type { ModuleKey } from "@/server/db/enums";

export type AdminRole =
  | "super_admin"
  | "operations_admin"
  | "billing_admin"
  | "support_manager"
  | "support_agent"
  | "security_auditor"
  | "read_only_admin";

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  mfaEnabled: boolean;
  roles: AdminRole[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminSession {
  id: string;
  adminUserId: string;
  sessionToken: string;
  ipAddress?: string;
  userAgent?: string;
  lastActiveAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  created?: Date;
}

export interface AdminAuditEvent {
  id: string;
  actorAdminId: string;
  actorRole: AdminRole;
  action: string;
  targetType: string;
  targetId: string;
  workspaceId?: string;
  userId?: string;
  ticketId?: string;
  reason?: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

export interface AdminInternalNote {
  id: string;
  targetType: "user" | "workspace" | "subscription" | "support_ticket" | "credit_entry";
  targetId: string;
  authorAdminId: string;
  authorName?: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export type SupportTicketCategory =
  | "account"
  | "billing"
  | "invoices"
  | "books"
  | "drive"
  | "quotes"
  | "technical"
  | "security"
  | "other";

export type SupportTicketPriority = "low" | "normal" | "high" | "urgent";

export type SupportTicketStatus =
  "open" | "waiting_for_support" | "waiting_for_customer" | "resolved" | "closed";

export interface SupportTicket {
  id: string;
  workspaceId?: string;
  requesterUserId: string;
  assignedAdminId?: string;
  subject: string;
  description: string;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
}

export type SupportAccessScope =
  | "workspace_settings"
  | "customers"
  | "invoices"
  | "quotes"
  | "books"
  | "drive"
  | "files"
  | "activity"
  | "integrations"
  | "technical_logs";

export type SupportAccessLevel = "metadata_only" | "read_only" | "guided_write";

export interface SupportAccessRequest {
  id: string;
  workspaceId: string;
  ticketId?: string;
  requestedByAdminId: string;
  scopes: SupportAccessScope[];
  accessLevel: SupportAccessLevel;
  reason: string;
  requestedDurationMinutes: number;
  customerExplanation?: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  createdAt: Date;
  updatedAt: Date;
}

export interface SupportAccessSession {
  id: string;
  requestId: string;
  workspaceId: string;
  ticketId?: string;
  approvedByUserId: string;
  adminUserId: string;
  scopes: SupportAccessScope[];
  accessLevel: SupportAccessLevel;
  reason: string;
  startsAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  revokedByUserId?: string;
  status: "pending" | "approved" | "active" | "expired" | "revoked" | "rejected";
}

export type PromotionDiscountType = "percentage" | "fixed_amount";
export type PromotionDuration = "once" | "repeating" | "forever";

export interface Promotion {
  id: string;
  name: string;
  internalDescription?: string;
  publicCode?: string;
  stripeCouponId: string;
  stripePromotionCodeId?: string;
  discountType: PromotionDiscountType;
  percentOff?: number;
  amountOffCents?: number;
  currency?: string;
  duration: PromotionDuration;
  durationInMonths?: number;
  maxRedemptions?: number;
  redeemBy?: Date;
  appliesToModules?: ModuleKey[];
  appliesToIntervals?: Array<"month" | "year">;
  newCustomersOnly: boolean;
  active: boolean;
  timesRedeemed: number;
  stripeCouponActive: boolean;
  stripePromotionCodeActive?: boolean | null;
  lastSyncedAt?: Date;
}

export type CreditLedgerEntryType =
  | "support_adjustment"
  | "service_interruption"
  | "billing_correction"
  | "retention_credit"
  | "promotional_credit"
  | "refund_conversion"
  | "manual_adjustment"
  | "credit_applied"
  | "credit_reversed"
  | "credit_expired";

export interface CreditLedgerEntry {
  id: string;
  workspaceId: string;
  amountCents: number;
  currency: string;
  type: CreditLedgerEntryType;
  reason: string;
  internalNote?: string;
  relatedTicketId?: string;
  relatedInvoiceId?: string;
  stripeReference?: string;
  createdByAdminId: string;
  createdAt: Date;
  expiresAt?: Date;
  reversedEntryId?: string;
}

export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  rolloutPercentage: number;
  workspaceAllowlist: string[];
  workspaceBlocklist: string[];
  userAllowlist: string[];
  createdAt: Date;
  updatedAt: Date;
}
