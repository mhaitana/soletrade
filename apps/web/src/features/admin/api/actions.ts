"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminContext } from "@/server/application/auth/admin-context";
import { AdminAuthorizationError } from "@/lib/domain/admin/permissions/index";
import {
  suspendUserAccount,
  restoreUserAccount,
} from "@/server/application/admin/services/admin-users";
import {
  suspendWorkspace,
  restoreWorkspace,
} from "@/server/application/admin/services/admin-workspaces";
import {
  issueWorkspaceCredit,
  reverseWorkspaceCredit,
  type IssueCreditParams,
} from "@/server/application/admin/services/admin-credits";
import {
  requestSupportAccess,
  revokeSupportAccess,
  type RequestSupportAccessParams,
} from "@/server/application/admin/services/admin-support-access";
import {
  updateFeatureFlagState,
  retryWebhookEvent,
} from "@/server/application/admin/services/admin-operations";
import { assignSupportTicket } from "@/server/application/admin/services/admin-support";
import {
  createPromotion,
  syncPromotionFromStripe,
  archivePromotion,
  type CreatePromotionParams,
} from "@/server/application/admin/services/admin-promotions";
import { reconcileSubscriptionMetadata } from "@/server/application/admin/services/admin-subscriptions";
import { CREDIT_TYPES, SUPPORT_SCOPES, ACCESS_LEVELS } from "@/features/admin/api/actions-helpers";
import type { PromotionDiscountType, PromotionDuration } from "@/lib/domain/admin/types/index";

/**
 * Shared result shape for admin Server Actions. Individual actions may attach
 * extra fields to the success branch (e.g. created ids); all are assignable to
 * this base. Consumed by the confirm-action dialog via useActionState.
 */
export type AdminActionResult =
  { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

const forbid = (msg = "You don't have permission to do that."): AdminActionResult => ({
  ok: false,
  error: msg,
});

/** Map a thrown error to a clean action result. Admin authorization errors become a
 *  stable permission message; everything else surfaces the underlying message. */
function catchAdmin(err: unknown, fallback: string): AdminActionResult {
  if (err instanceof AdminAuthorizationError) return forbid();
  return { ok: false, error: err instanceof Error ? err.message : fallback };
}

/** Detect the Stripe-not-configured boundary error thrown by `getStripe()` so the
 *  dialog surfaces an actionable message instead of a generic failure. Secrets are
 *  optional, so dev-without-Stripe must not crash with a cryptic stack. */
function isStripeNotConfigured(err: unknown): boolean {
  return err instanceof Error && /STRIPE_SECRET_KEY/.test(err.message);
}
const STRIPE_NOT_CONFIGURED =
  "Stripe is not configured — set STRIPE_SECRET_KEY to manage coupons on Stripe.";

const idSchema = z.string().uuid();
const reasonSchema = z
  .string()
  .trim()
  .min(3, "A clear reason is required (min 3 characters).")
  .max(500, "Reason is too long (max 500 characters).");

// ────────────────────────────────────────────────────────────────────────────
// Users
// ────────────────────────────────────────────────────────────────────────────

const suspendUserSchema = z.object({
  userId: idSchema,
  reason: reasonSchema,
});

export type SuspendUserResult = AdminActionResult;

export async function suspendUserAction(input: unknown): Promise<SuspendUserResult> {
  const parsed = suspendUserSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    await requireAdminContext("manage:users");
    await suspendUserAccount(parsed.data.userId, parsed.data.reason);
    revalidatePath(`/admin/users/${parsed.data.userId}`);
    revalidatePath("/admin/users");
    revalidatePath("/admin/audit");
    return { ok: true };
  } catch (err) {
    return catchAdmin(err, "Failed to suspend user.");
  }
}

export type RestoreUserResult = AdminActionResult;

export async function restoreUserAction(input: unknown): Promise<RestoreUserResult> {
  const parsed = suspendUserSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    await requireAdminContext("manage:users");
    await restoreUserAccount(parsed.data.userId, parsed.data.reason);
    revalidatePath(`/admin/users/${parsed.data.userId}`);
    revalidatePath("/admin/users");
    revalidatePath("/admin/audit");
    return { ok: true };
  } catch (err) {
    return catchAdmin(err, "Failed to restore user.");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Workspaces
// ────────────────────────────────────────────────────────────────────────────

const workspaceActionSchema = z.object({
  workspaceId: idSchema,
  reason: reasonSchema,
});

export type SuspendWorkspaceResult = AdminActionResult;

export async function suspendWorkspaceAction(input: unknown): Promise<SuspendWorkspaceResult> {
  const parsed = workspaceActionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    await requireAdminContext("manage:workspaces");
    await suspendWorkspace(parsed.data.workspaceId, parsed.data.reason);
    revalidatePath(`/admin/workspaces/${parsed.data.workspaceId}`);
    revalidatePath("/admin/workspaces");
    revalidatePath("/admin/audit");
    return { ok: true };
  } catch (err) {
    return catchAdmin(err, "Failed to suspend workspace.");
  }
}

export type RestoreWorkspaceResult = AdminActionResult;

export async function restoreWorkspaceAction(input: unknown): Promise<RestoreWorkspaceResult> {
  const parsed = workspaceActionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    await requireAdminContext("manage:workspaces");
    await restoreWorkspace(parsed.data.workspaceId, parsed.data.reason);
    revalidatePath(`/admin/workspaces/${parsed.data.workspaceId}`);
    revalidatePath("/admin/workspaces");
    revalidatePath("/admin/audit");
    return { ok: true };
  } catch (err) {
    return catchAdmin(err, "Failed to restore workspace.");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Credits
// ────────────────────────────────────────────────────────────────────────────

const issueCreditSchema = z.object({
  workspaceId: idSchema,
  amountCents: z
    .number()
    .int()
    .refine((n) => n !== 0, "Amount cannot be zero."),
  currency: z.string().trim().min(3).max(3).default("AUD"),
  type: z.enum(CREDIT_TYPES),
  reason: reasonSchema,
  internalNote: z.string().trim().max(2000).optional(),
  relatedTicketId: z.string().trim().max(100).optional(),
});

export type IssueCreditResult = AdminActionResult;

export async function issueCreditAction(input: unknown): Promise<IssueCreditResult> {
  const parsed = issueCreditSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    await requireAdminContext("create:credits");
    const params: IssueCreditParams = {
      workspaceId: parsed.data.workspaceId,
      amountCents: parsed.data.amountCents,
      currency: parsed.data.currency,
      type: parsed.data.type,
      reason: parsed.data.reason,
      internalNote: parsed.data.internalNote,
      relatedTicketId: parsed.data.relatedTicketId,
    };
    await issueWorkspaceCredit(params);
    revalidatePath(`/admin/workspaces/${parsed.data.workspaceId}`);
    revalidatePath("/admin/credits");
    revalidatePath("/admin/audit");
    return { ok: true };
  } catch (err) {
    return catchAdmin(err, "Failed to issue credit.");
  }
}

const reverseCreditSchema = z.object({
  entryId: idSchema,
  workspaceId: idSchema,
  reason: reasonSchema,
});

export type ReverseCreditResult = AdminActionResult;

export async function reverseCreditAction(input: unknown): Promise<ReverseCreditResult> {
  const parsed = reverseCreditSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    await requireAdminContext("manage:credits");
    await reverseWorkspaceCredit(parsed.data.entryId, parsed.data.workspaceId, parsed.data.reason);
    revalidatePath(`/admin/workspaces/${parsed.data.workspaceId}`);
    revalidatePath("/admin/credits");
    revalidatePath("/admin/audit");
    return { ok: true };
  } catch (err) {
    return catchAdmin(err, "Failed to reverse credit entry.");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Support access
// ────────────────────────────────────────────────────────────────────────────

const requestSupportAccessSchema = z.object({
  workspaceId: idSchema,
  ticketId: z.string().trim().max(100).optional(),
  scopes: z.array(z.enum(SUPPORT_SCOPES)).min(1, "Select at least one scope."),
  accessLevel: z.enum(ACCESS_LEVELS),
  reason: z.string().trim().min(5, "A detailed reason is required (min 5 characters).").max(500),
  requestedDurationMinutes: z.number().int().min(1).max(1440).default(60),
  customerExplanation: z.string().trim().max(2000).optional(),
});

export type RequestSupportAccessResult = AdminActionResult;

export async function requestSupportAccessAction(
  input: unknown,
): Promise<RequestSupportAccessResult> {
  const parsed = requestSupportAccessSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    await requireAdminContext("create:support_access");
    const params: RequestSupportAccessParams = {
      workspaceId: parsed.data.workspaceId,
      ticketId: parsed.data.ticketId,
      scopes: parsed.data.scopes,
      accessLevel: parsed.data.accessLevel,
      reason: parsed.data.reason,
      requestedDurationMinutes: parsed.data.requestedDurationMinutes,
      customerExplanation: parsed.data.customerExplanation,
    };
    await requestSupportAccess(params);
    revalidatePath("/admin/access-requests");
    revalidatePath("/admin/audit");
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (err) {
    return catchAdmin(err, "Failed to request support access.");
  }
}

const revokeSupportAccessSchema = z.object({
  sessionId: idSchema,
});

export type RevokeSupportAccessResult = AdminActionResult;

export async function revokeSupportAccessAction(
  input: unknown,
): Promise<RevokeSupportAccessResult> {
  const parsed = revokeSupportAccessSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid session." };
  try {
    const ctx = await requireAdminContext("manage:support_access");
    await revokeSupportAccess(parsed.data.sessionId, ctx.adminUser.id);
    revalidatePath("/admin/access-requests");
    revalidatePath("/admin/audit");
    // Layout-rendered banner must re-run; use the "layout" revalidate form.
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (err) {
    return catchAdmin(err, "Failed to revoke support access session.");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Feature flags / webhooks / tickets
// ────────────────────────────────────────────────────────────────────────────

const updateFeatureFlagSchema = z.object({
  flagId: idSchema,
  enabled: z.boolean(),
  reason: reasonSchema,
});

export type UpdateFeatureFlagResult = AdminActionResult;

export async function updateFeatureFlagAction(input: unknown): Promise<UpdateFeatureFlagResult> {
  const parsed = updateFeatureFlagSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    await requireAdminContext("manage:feature_flags");
    await updateFeatureFlagState(parsed.data.flagId, parsed.data.enabled, parsed.data.reason);
    revalidatePath("/admin/feature-flags");
    revalidatePath("/admin/audit");
    return { ok: true };
  } catch (err) {
    return catchAdmin(err, "Failed to update feature flag.");
  }
}

const retryWebhookSchema = z.object({
  id: idSchema,
  reason: reasonSchema,
});

export type RetryWebhookResult = AdminActionResult;

export async function retryWebhookAction(input: unknown): Promise<RetryWebhookResult> {
  const parsed = retryWebhookSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    await requireAdminContext("manage:operations");
    await retryWebhookEvent(parsed.data.id, parsed.data.reason);
    revalidatePath("/admin/webhooks");
    revalidatePath("/admin/audit");
    return { ok: true };
  } catch (err) {
    return catchAdmin(err, "Failed to retry webhook event.");
  }
}

const assignTicketSchema = z.object({
  ticketId: idSchema,
  assignedAdminId: idSchema,
  reason: z.string().trim().max(500).optional(),
});

export type AssignTicketResult = AdminActionResult;

export async function assignSupportTicketAction(input: unknown): Promise<AssignTicketResult> {
  const parsed = assignTicketSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    await requireAdminContext("manage:support_tickets");
    await assignSupportTicket(
      parsed.data.ticketId,
      parsed.data.assignedAdminId,
      parsed.data.reason ?? "Ticket assignment",
    );
    revalidatePath("/admin/support");
    revalidatePath("/admin/audit");
    return { ok: true };
  } catch (err) {
    return catchAdmin(err, "Failed to assign ticket.");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Promotions / subscriptions
// ────────────────────────────────────────────────────────────────────────────

const DISCOUNT_TYPES = [
  "percentage",
  "fixed_amount",
] as const satisfies readonly PromotionDiscountType[];
const DURATIONS = ["once", "repeating", "forever"] as const satisfies readonly PromotionDuration[];

const CURRENCIES = ["AUD", "NZD", "USD"] as const;

const createPromotionSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  internalDescription: z.string().trim().max(2000).optional(),
  publicCode: z
    .string()
    .trim()
    .min(3, "Code must be at least 3 characters.")
    .max(40, "Code must be 40 characters or fewer.")
    .regex(/^[a-zA-Z0-9-]+$/, "Use letters, numbers, or hyphens only.")
    .transform((value) => value.toUpperCase())
    .optional(),
  currency: z.enum(CURRENCIES).default("AUD"),
  discountType: z.enum(DISCOUNT_TYPES),
  percentOff: z.number().min(1).max(100).optional(),
  amountOffCents: z.number().int().positive().optional(),
  duration: z.enum(DURATIONS),
  durationInMonths: z.number().int().min(1).max(120).optional(),
  maxRedemptions: z.number().int().positive().optional(),
  newCustomersOnly: z.boolean().default(false),
  reason: reasonSchema,
});

export type CreatePromotionResult = AdminActionResult;

export async function createPromotionAction(input: unknown): Promise<CreatePromotionResult> {
  const parsed = createPromotionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    await requireAdminContext("manage:promotions");
    const params: CreatePromotionParams = {
      name: parsed.data.name,
      internalDescription: parsed.data.internalDescription,
      publicCode: parsed.data.publicCode,
      currency: parsed.data.currency,
      discountType: parsed.data.discountType,
      percentOff: parsed.data.percentOff,
      amountOffCents: parsed.data.amountOffCents,
      duration: parsed.data.duration,
      durationInMonths: parsed.data.durationInMonths,
      maxRedemptions: parsed.data.maxRedemptions,
      newCustomersOnly: parsed.data.newCustomersOnly,
      reason: parsed.data.reason,
    };
    await createPromotion(params);
    revalidatePath("/admin/promotions");
    revalidatePath("/admin/audit");
    return { ok: true };
  } catch (err) {
    if (isStripeNotConfigured(err)) return { ok: false, error: STRIPE_NOT_CONFIGURED };
    return catchAdmin(err, "Failed to create promotion.");
  }
}

const syncPromotionSchema = z.object({
  promotionId: idSchema,
});

export type SyncPromotionResult = AdminActionResult;

export async function syncPromotionAction(input: unknown): Promise<SyncPromotionResult> {
  const parsed = syncPromotionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    await requireAdminContext("manage:promotions");
    await syncPromotionFromStripe(parsed.data.promotionId);
    revalidatePath("/admin/promotions");
    revalidatePath("/admin/audit");
    return { ok: true };
  } catch (err) {
    if (isStripeNotConfigured(err)) return { ok: false, error: STRIPE_NOT_CONFIGURED };
    return catchAdmin(err, "Failed to sync promotion from Stripe.");
  }
}

const archivePromotionSchema = z.object({
  promotionId: idSchema,
  reason: reasonSchema,
});

export type ArchivePromotionResult = AdminActionResult;

export async function archivePromotionAction(input: unknown): Promise<ArchivePromotionResult> {
  const parsed = archivePromotionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    await requireAdminContext("manage:promotions");
    await archivePromotion(parsed.data.promotionId, parsed.data.reason);
    revalidatePath("/admin/promotions");
    revalidatePath("/admin/audit");
    return { ok: true };
  } catch (err) {
    if (isStripeNotConfigured(err)) return { ok: false, error: STRIPE_NOT_CONFIGURED };
    return catchAdmin(err, "Failed to archive promotion.");
  }
}

const reconcileSubscriptionSchema = z.object({
  workspaceId: idSchema,
  reason: reasonSchema,
});

export type ReconcileSubscriptionResult = AdminActionResult;

export async function reconcileSubscriptionAction(
  input: unknown,
): Promise<ReconcileSubscriptionResult> {
  const parsed = reconcileSubscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  try {
    await requireAdminContext("manage:subscriptions");
    await reconcileSubscriptionMetadata(parsed.data.workspaceId, parsed.data.reason);
    revalidatePath("/admin/subscriptions");
    revalidatePath("/admin/audit");
    return { ok: true };
  } catch (err) {
    return catchAdmin(err, "Failed to reconcile subscription.");
  }
}
