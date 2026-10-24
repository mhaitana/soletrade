/**
 * Non-action exports shared between admin Server Actions and their client dialog
 * wrappers. This module deliberately has NO `"use server"` directive — a `"use server"`
 * file may only export async functions (Next.js enforces this at runtime via the
 * server-action loader), so const arrays and other runtime values live here and are
 * imported by both `actions.ts` (for zod schemas) and the dialog wrappers (for option
 * lists).
 */
import type {
  CreditLedgerEntryType,
  SupportAccessLevel,
  SupportAccessScope,
} from "@/lib/domain/admin/types/index";

export const CREDIT_TYPES = [
  "support_adjustment",
  "service_interruption",
  "billing_correction",
  "retention_credit",
  "promotional_credit",
  "refund_conversion",
  "manual_adjustment",
] as const satisfies readonly CreditLedgerEntryType[];

export const SUPPORT_SCOPES = [
  "workspace_settings",
  "customers",
  "invoices",
  "quotes",
  "books",
  "drive",
  "files",
  "activity",
  "integrations",
  "technical_logs",
] as const satisfies readonly SupportAccessScope[];

export const ACCESS_LEVELS = [
  "metadata_only",
  "read_only",
  "guided_write",
] as const satisfies readonly SupportAccessLevel[];
