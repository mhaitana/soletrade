import type { Database } from "./types";
import type * as Public from "@/lib/domain/database-enums";
import type { Json } from "@/lib/domain/json";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

/** Compilation fails when generated database enums drift from browser-safe contracts. */
export type DatabaseContractCompatibility = [
  Assert<Equal<Public.WorkspaceRole, Database["public"]["Enums"]["workspace_role"]>>,
  Assert<Equal<Public.ModuleKey, Database["public"]["Enums"]["module_key"]>>,
  Assert<
    Equal<
      Public.ModuleInstallationStatus,
      Database["public"]["Enums"]["module_installation_status"]
    >
  >,
  Assert<Equal<Public.InvitationStatus, Database["public"]["Enums"]["invitation_status"]>>,
  Assert<Equal<Public.BillingInterval, Database["public"]["Enums"]["billing_interval"]>>,
  Assert<Equal<Public.SubscriptionStatus, Database["public"]["Enums"]["subscription_status"]>>,
  Assert<Equal<Public.CreditEntryType, Database["public"]["Enums"]["credit_entry_type"]>>,
  Assert<Equal<Public.InvoiceStatus, Database["public"]["Enums"]["invoice_status"]>>,
  Assert<Equal<Public.QuoteStatus, Database["public"]["Enums"]["quote_status"]>>,
  Assert<Equal<Public.BookType, Database["public"]["Enums"]["book_type"]>>,
  Assert<
    Equal<Public.ReceiptExtractionStatus, Database["public"]["Enums"]["receipt_extraction_status"]>
  >,
  Assert<Equal<Public.VehicleExpenseType, Database["public"]["Enums"]["vehicle_expense_type"]>>,
  Assert<Equal<Public.AiMessageRole, Database["public"]["Enums"]["ai_message_role"]>>,
  Assert<Equal<Json, import("./types").Json>>,
];
