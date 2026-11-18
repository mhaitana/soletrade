import "server-only";
import type { ActionPreview } from "@/lib/assistant/messages";
import { assistantToolInfo } from "@/lib/assistant/tool-catalog";
import type { WorkspaceContext } from "@/lib/domain/auth/workspace-context-types";
import { formatCents } from "@/lib/domain/billing/pricing";
import { categoryLabel } from "@/config/books-categories";
import { platformLabel } from "@/config/drive-platforms";
import { getCustomer, getCustomerByEmail } from "@/server/foundation/customers/index";
import { getInvoice } from "@/server/domains/invoices/index";
import { getQuote } from "@/server/domains/quotes/index";
import { getTransaction } from "@/server/domains/books/index";
import { resolveInvoiceByNumber, resolveQuoteByNumber } from "@/server/application/assistant/tools";
import { formatDate } from "@/utils/format-date";
import { computeLineItemTotals } from "@/utils/totals";
import { branded } from "@/types/ids";

/**
 * What an approval card shows for a change hAI wants to make. Built on the server from the
 * server's own copy of the tool call and the records it touches, so the user approves the
 * real recipient and the real total, not numbers the model or the browser wrote.
 *
 * Never throws: a lookup that fails gives a plainer card, never a lost approval.
 */

type Input = Record<string, unknown>;

const MAX_LINES = 5;

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function isoDate(value: unknown): string | undefined {
  const text = str(value);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : formatDate(date);
}

function customerLine(name: string | null | undefined, email: string | null | undefined): string {
  if (name && email) return `Customer: ${name} (${email})`;
  if (name) return `Customer: ${name}`;
  if (email) return `Customer: ${email}`;
  return "Customer: none (walk-in)";
}

async function customerFor(
  ctx: WorkspaceContext,
  input: Input,
): Promise<{ line: string; missing?: string }> {
  const id = str(input.customerId);
  const email = str(input.customerEmail);
  if (id) {
    const customer = await getCustomer(ctx.workspaceId, branded<"CustomerId">(id));
    return customer
      ? { line: customerLine(customer.name, customer.email) }
      : { line: "Customer: not found", missing: "That customer was not found, so this will fail." };
  }
  if (email) {
    const customer = await getCustomerByEmail(ctx.workspaceId, email);
    return customer
      ? { line: customerLine(customer.name, customer.email) }
      : {
          line: `Customer: ${email}`,
          missing: `No customer with ${email} exists yet, so this will fail.`,
        };
  }
  return { line: customerLine(null, null) };
}

function lineItems(
  input: Input,
): { description: string; quantity: number; unitPriceCents: number }[] {
  if (!Array.isArray(input.lineItems)) return [];
  return input.lineItems.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const line = raw as Input;
    const quantity = num(line.quantity);
    const unitPriceCents = num(line.unitPriceCents);
    if (quantity === undefined || unitPriceCents === undefined) return [];
    return [{ description: str(line.description) ?? "Item", quantity, unitPriceCents }];
  });
}

function documentDetails(
  input: Input,
  currency: string,
  dateLabel: string,
  dateKey: string,
): string[] {
  const lines = lineItems(input);
  const taxRate = num(input.taxRate) ?? 0;
  const details: string[] = [];
  const issued = isoDate(input.issueDate);
  if (issued) details.push(`Issue date: ${issued}`);
  const second = isoDate(input[dateKey]);
  if (second) details.push(`${dateLabel}: ${second}`);
  for (const line of lines.slice(0, MAX_LINES)) {
    details.push(
      `${line.quantity} × ${line.description} at ${formatCents(line.unitPriceCents, currency)}`,
    );
  }
  if (lines.length > MAX_LINES) details.push(`and ${lines.length - MAX_LINES} more lines`);
  if (lines.length > 0) {
    const totals = computeLineItemTotals(lines, taxRate);
    details.push(
      `Total: ${formatCents(totals.totalCents, currency)} (${taxRate}% tax ${formatCents(totals.taxCents, currency)})`,
    );
  }
  return details;
}

function changeLine(
  label: string,
  from: string | null | undefined,
  to: string | undefined,
): string | null {
  if (to === undefined) return null;
  return from && from !== to ? `${label}: ${from} → ${to}` : `${label}: ${to}`;
}

async function previewFor(
  ctx: WorkspaceContext,
  toolName: string,
  input: Input,
  currency: string,
): Promise<ActionPreview> {
  const money = (cents: unknown, code?: unknown) =>
    formatCents(num(cents) ?? 0, str(code)?.toUpperCase() ?? currency);

  switch (toolName) {
    case "createCustomer":
      return {
        title: `Add customer ${str(input.name) ?? ""}`.trim(),
        details: [
          str(input.email) && `Email: ${str(input.email)}`,
          str(input.phone) && `Phone: ${str(input.phone)}`,
          str(input.company) && `Company: ${str(input.company)}`,
        ].filter((line): line is string => Boolean(line)),
        consequence: "Adds the customer to this workspace.",
      };

    case "updateCustomer": {
      const id = str(input.customerId);
      const customer = id ? await getCustomer(ctx.workspaceId, branded<"CustomerId">(id)) : null;
      if (!customer) {
        return {
          title: "Update a customer",
          details: ["That customer was not found, so this will fail."],
        };
      }
      return {
        title: `Update customer ${customer.name}`,
        details: [
          changeLine("Name", customer.name, str(input.name)),
          changeLine("Email", customer.email, str(input.email)),
          changeLine("Phone", customer.phone, str(input.phone)),
          changeLine("Company", customer.company, str(input.company)),
          str(input.notes) ? "Notes: replaced" : null,
        ].filter((line): line is string => Boolean(line)),
      };
    }

    case "createInvoice":
    case "createQuote": {
      const isInvoice = toolName === "createInvoice";
      const code = str(input.currency)?.toUpperCase() ?? currency;
      const customer = await customerFor(ctx, input);
      return {
        title: isInvoice ? "Create a draft invoice" : "Create a draft quote",
        details: [
          customer.line,
          ...documentDetails(
            input,
            code,
            isInvoice ? "Due date" : "Valid until",
            isInvoice ? "dueDate" : "validUntil",
          ),
          ...(customer.missing ? [customer.missing] : []),
        ],
        consequence: "Saves a draft. Nothing is sent to the customer.",
      };
    }

    case "createTransaction": {
      const type = input.type === "income" ? "income" : "expense";
      const category = str(input.category);
      const customer =
        str(input.customerId) || str(input.customerEmail) ? await customerFor(ctx, input) : null;
      return {
        title: `Record ${type} of ${money(input.amountCents)}`,
        details: [
          str(input.description) && `Description: ${str(input.description)}`,
          isoDate(input.date) && `Date: ${isoDate(input.date)}`,
          category && `Category: ${categoryLabel(type, category) ?? category}`,
          customer?.line,
          customer?.missing,
        ].filter((line): line is string => Boolean(line)),
        consequence: "Adds the transaction to Books.",
      };
    }

    case "updateTransaction":
    case "deleteTransaction": {
      const id = str(input.transactionId);
      const tx = id
        ? await getTransaction(ctx.workspaceId, branded<"BookTransactionId">(id))
        : null;
      if (!tx) {
        return {
          title: toolName === "deleteTransaction" ? "Delete a transaction" : "Update a transaction",
          details: ["That transaction was not found, so this will fail."],
        };
      }
      const amount = formatCents(tx.amountCents, tx.currency);
      if (toolName === "deleteTransaction") {
        return {
          title: `Delete ${tx.type} "${tx.description}"`,
          details: [
            `Amount: ${amount}`,
            `Date: ${formatDate(tx.date)}`,
            `Category: ${categoryLabel(tx.type, tx.category) ?? tx.category}`,
          ],
          consequence: "Permanently deletes the transaction from Books.",
          caution: "cannot-undo",
        };
      }
      const newType = input.type === "income" || input.type === "expense" ? input.type : tx.type;
      const newCategory = str(input.category);
      return {
        title: `Update ${tx.type} "${tx.description}"`,
        details: [
          changeLine("Type", tx.type, input.type === tx.type ? undefined : str(input.type)),
          num(input.amountCents) !== undefined
            ? changeLine("Amount", amount, formatCents(num(input.amountCents)!, tx.currency))
            : null,
          isoDate(input.date) ? changeLine("Date", formatDate(tx.date), isoDate(input.date)) : null,
          changeLine("Description", tx.description, str(input.description)),
          newCategory
            ? changeLine(
                "Category",
                categoryLabel(tx.type, tx.category) ?? tx.category,
                categoryLabel(newType, newCategory) ?? newCategory,
              )
            : null,
          str(input.customerId) || str(input.customerEmail)
            ? (await customerFor(ctx, input)).line
            : null,
          str(input.notes) ? "Notes: replaced" : null,
        ].filter((line): line is string => Boolean(line)),
      };
    }

    case "extractReceipt":
      return {
        title: "Read a receipt with AI",
        details: ["The result goes to the receipt review queue for you to check."],
        consequence: "May use AI credit. Nothing is added to Books until you apply it.",
      };

    case "createEarning": {
      const platform = str(input.platform);
      return {
        title: `Log ${money(input.amountCents, input.currency)} of earnings`,
        details: [
          platform && `Platform: ${platformLabel(platform) ?? platform}`,
          isoDate(input.date) && `Date: ${isoDate(input.date)}`,
          str(input.description) && `Description: ${str(input.description)}`,
        ].filter((line): line is string => Boolean(line)),
        consequence: "Adds the earning to Drive (and to Books if Books is on).",
      };
    }

    case "createTrip": {
      const platform = str(input.platform);
      const km = num(input.distanceKm);
      return {
        title: km !== undefined ? `Log a ${km} km trip` : "Log a trip",
        details: [
          platform && `Platform: ${platformLabel(platform) ?? platform}`,
          isoDate(input.date) && `Date: ${isoDate(input.date)}`,
          str(input.purpose) && `Purpose: ${str(input.purpose)}`,
        ].filter((line): line is string => Boolean(line)),
        consequence: "Adds the trip to Drive (and its mileage to Books if Books is on).",
      };
    }

    case "createExpense":
      return {
        title: `Log a ${str(input.type) ?? "vehicle"} expense of ${money(input.amountCents, input.currency)}`,
        details: [
          (str(input.vehicleName) || str(input.vehicleId)) &&
            `Vehicle: ${str(input.vehicleName) ?? "selected vehicle"}`,
          isoDate(input.date) && `Date: ${isoDate(input.date)}`,
          str(input.description) && `Description: ${str(input.description)}`,
        ].filter((line): line is string => Boolean(line)),
        consequence: "Adds the expense to Drive (and to Books if Books is on).",
      };

    case "sendInvoice":
    case "voidInvoice":
    case "markInvoicePaid": {
      const number = str(input.invoiceNumber) ?? "";
      const verb =
        toolName === "sendInvoice" ? "Send" : toolName === "voidInvoice" ? "Void" : "Mark paid:";
      const found = number ? await resolveInvoiceByNumber(ctx.workspaceId, number) : null;
      const invoice = found ? await getInvoice(ctx.workspaceId, found.id) : null;
      if (!invoice) {
        return {
          title: `${verb} invoice ${number}`.trim(),
          details: ["That invoice was not found, so this will fail."],
        };
      }
      const customer = invoice.customerId
        ? await getCustomer(ctx.workspaceId, invoice.customerId)
        : null;
      const email = customer?.email ?? null;
      const details = [
        customerLine(customer?.name ?? invoice.customerName, email),
        `Total: ${formatCents(invoice.totalCents, invoice.currency)}`,
        invoice.dueDate ? `Due: ${formatDate(invoice.dueDate)}` : null,
        `Status now: ${invoice.status}`,
      ].filter((line): line is string => Boolean(line));
      if (toolName === "sendInvoice") {
        return {
          title: `Send invoice ${invoice.number}`,
          details,
          consequence: email
            ? `Emails ${email} the invoice with a payment link.`
            : "Marks the invoice sent. The customer has no email address, so no email goes out.",
          caution: "sends-message",
        };
      }
      if (toolName === "voidInvoice") {
        return {
          title: `Void invoice ${invoice.number}`,
          details,
          consequence: "The invoice can no longer be paid. Voiding cannot be reversed.",
          caution: "cannot-undo",
        };
      }
      return {
        title: `Mark invoice ${invoice.number} paid`,
        details,
        consequence: email
          ? `Records the payment and emails ${email} a receipt.`
          : "Records the payment.",
        caution: "sends-message",
      };
    }

    case "convertQuoteToInvoice": {
      const number = str(input.quoteNumber) ?? "";
      const found = number ? await resolveQuoteByNumber(ctx.workspaceId, number) : null;
      const quote = found ? await getQuote(ctx.workspaceId, found.id) : null;
      if (!quote) {
        return {
          title: `Create an invoice from quote ${number}`.trim(),
          details: ["That quote was not found, so this will fail."],
        };
      }
      return {
        title: `Create an invoice from quote ${quote.number}`,
        details: [
          customerLine(quote.customerName, null),
          `Total: ${formatCents(quote.totalCents, quote.currency)}`,
          `Quote status: ${quote.status}`,
        ],
        consequence: "Creates a draft invoice from the quote. Nothing is sent.",
      };
    }

    default:
      return { title: assistantToolInfo(toolName).running, details: [] };
  }
}

export async function buildActionPreview(
  ctx: WorkspaceContext,
  toolName: string,
  input: unknown,
  opts: { currency: string },
): Promise<ActionPreview> {
  const info = assistantToolInfo(toolName);
  const record =
    input && typeof input === "object" && !Array.isArray(input) ? (input as Input) : {};
  try {
    const preview = await previewFor(ctx, toolName, record, opts.currency);
    const caution = preview.caution ?? info.caution;
    return {
      ...preview,
      title: preview.title || info.running,
      details: preview.details.map((line) => line.slice(0, 200)).slice(0, 12),
      ...(caution ? { caution } : {}),
    };
  } catch (err) {
    console.error(`[assistant] could not build a preview for ${toolName}:`, err);
    return {
      title: info.running,
      details: ["The details could not be loaded. Check the record before approving."],
      ...(info.caution ? { caution: info.caution } : {}),
    };
  }
}
