import { z } from "zod";

/**
 * Payment-method types shared by workspace settings and invoices.
 *
 * The database stores these as a jsonb array on `workspaces.payment_methods` and
 * `invoices.payment_methods`. This module is the single source of truth for the
 * shape, validation, and display helpers. It is safe to import from client code.
 */

const LABEL_MAX = 80;
const NAME_MAX = 120;
const CODE_MAX = 60;
const REF_MAX = 120;
const EMAIL_MAX = 254;
const ID_MAX = 254;

const optionalLabel = z.string().trim().max(LABEL_MAX, "Label is too long.").optional();

export const bankTransferMethodSchema = z.object({
  type: z.literal("bank_transfer"),
  label: optionalLabel,
  accountName: z.string().trim().min(1, "Account name is required.").max(NAME_MAX),
  bsb: z.string().trim().min(1, "BSB is required.").max(CODE_MAX),
  accountNumber: z.string().trim().min(1, "Account number is required.").max(CODE_MAX),
  bankName: z.string().trim().max(NAME_MAX).optional(),
  reference: z.string().trim().max(REF_MAX).optional(),
});

export const paypalMethodSchema = z.object({
  type: z.literal("paypal"),
  label: optionalLabel,
  email: z
    .string()
    .trim()
    .min(1, "PayPal email is required.")
    .email("PayPal email is invalid.")
    .max(EMAIL_MAX),
});

export const payidMethodSchema = z.object({
  type: z.literal("payid"),
  label: optionalLabel,
  identifier: z.string().trim().min(1, "PayID identifier is required.").max(ID_MAX),
});

export const paymentMethodSchema = z.discriminatedUnion("type", [
  bankTransferMethodSchema,
  paypalMethodSchema,
  payidMethodSchema,
]);

export const paymentMethodsSchema = z
  .array(paymentMethodSchema)
  .max(10, "At most 10 payment methods are allowed.");

export type BankTransferMethod = z.infer<typeof bankTransferMethodSchema>;
export type PaypalMethod = z.infer<typeof paypalMethodSchema>;
export type PayidMethod = z.infer<typeof payidMethodSchema>;
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export type PaymentMethods = z.infer<typeof paymentMethodsSchema>;

const DEFAULT_LABELS: Record<PaymentMethod["type"], string> = {
  bank_transfer: "Bank transfer",
  paypal: "PayPal",
  payid: "PayID",
};

export function getPaymentMethodLabel(method: PaymentMethod): string {
  return method.label?.trim() || DEFAULT_LABELS[method.type];
}

export interface PaymentMethodLine {
  label: string;
  value: string;
}

/**
 * Render a payment method as human-readable detail lines. Sensitive-ish values such as
 * account numbers are kept verbatim; the caller decides visual presentation.
 */
export function getPaymentMethodDetails(method: PaymentMethod): PaymentMethodLine[] {
  switch (method.type) {
    case "bank_transfer":
      return [
        { label: "Account name", value: method.accountName },
        { label: "BSB", value: method.bsb },
        { label: "Account number", value: method.accountNumber },
        ...(method.bankName ? [{ label: "Bank", value: method.bankName }] : []),
        ...(method.reference ? [{ label: "Reference", value: method.reference }] : []),
      ];
    case "paypal":
      return [{ label: "PayPal email", value: method.email }];
    case "payid":
      return [{ label: "PayID", value: method.identifier }];
    default: {
      const _exhaustive: never = method;
      return _exhaustive as PaymentMethodLine[];
    }
  }
}

/**
 * Parse an unknown jsonb value into a validated payment-method list.
 * Returns an empty array for null / undefined / empty.
 */
export function parsePaymentMethods(
  value: unknown,
): { ok: true; methods: PaymentMethods } | { ok: false; error: string } {
  if (value === null || value === undefined) {
    return { ok: true, methods: [] };
  }
  const parsed = paymentMethodsSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid payment methods." };
  }
  return { ok: true, methods: parsed.data };
}

/**
 * Resolve the payment methods to show for an invoice.
 * The invoice-level list wins when present; otherwise the workspace default is used.
 */
export function resolveInvoicePaymentMethods(
  invoiceMethods: unknown,
  workspaceMethods: unknown,
): PaymentMethods {
  const invoice = parsePaymentMethods(invoiceMethods);
  if (invoice.ok && invoice.methods.length > 0) {
    return invoice.methods;
  }
  const workspace = parsePaymentMethods(workspaceMethods);
  return workspace.ok ? workspace.methods : [];
}
