/**
 * What each assistant tool is, in plain words. Browser-safe: the server uses it to decide
 * which tool calls are recorded as assistant actions, and the chat uses it to show every
 * tool call as a card, so a lookup or a change is never invisible to the user.
 *
 * `kind` is the safety class:
 * - `navigate`: opens a page or an unsaved form. Changes nothing.
 * - `read`: looks data up. Changes nothing.
 * - `write`: creates, changes, sends or deletes something.
 *
 * A tool that is missing from this list is treated as `write`, so a tool added without an
 * entry is recorded and shown as an action rather than slipping through as a harmless read.
 */

export type AssistantToolKind = "navigate" | "read" | "write";

export interface AssistantToolInfo {
  kind: AssistantToolKind;
  /** Shown while the call is in progress, e.g. "Looking up invoices". */
  running: string;
  /** Shown when it finished, e.g. "Looked up invoices". */
  done: string;
  /** Write tools: the kind of record acted on (stored as the audit target type). */
  target?: string;
  /** Write tools whose effect reaches someone outside the workspace or cannot be undone. */
  caution?: "sends-message" | "cannot-undo";
}

const read = (noun: string): AssistantToolInfo => ({
  kind: "read",
  running: `Looking up ${noun}`,
  done: `Looked up ${noun}`,
});

export const ASSISTANT_TOOLS: Record<string, AssistantToolInfo> = {
  navigateWorkspace: { kind: "navigate", running: "Finding the page", done: "Opened a page" },
  openForm: { kind: "navigate", running: "Preparing a draft", done: "Prepared a draft" },

  getWorkspaceOverview: read("the workspace overview"),
  listInvoices: read("invoices"),
  listQuotes: read("quotes"),
  listTransactions: read("transactions"),
  listDriveEarnings: read("drive earnings"),
  listDriveTrips: read("trips"),
  listDriveVehicles: read("vehicles"),
  listDriveExpenses: read("vehicle expenses"),
  listCustomers: read("customers"),
  listRecentActivity: read("recent activity"),

  createCustomer: {
    kind: "write",
    running: "Adding a customer",
    done: "Added a customer",
    target: "customer",
  },
  updateCustomer: {
    kind: "write",
    running: "Updating a customer",
    done: "Updated a customer",
    target: "customer",
  },
  createInvoice: {
    kind: "write",
    running: "Creating a draft invoice",
    done: "Created a draft invoice",
    target: "invoice",
  },
  createQuote: {
    kind: "write",
    running: "Creating a draft quote",
    done: "Created a draft quote",
    target: "quote",
  },
  createTransaction: {
    kind: "write",
    running: "Recording a transaction",
    done: "Recorded a transaction",
    target: "book_transaction",
  },
  updateTransaction: {
    kind: "write",
    running: "Updating a transaction",
    done: "Updated a transaction",
    target: "book_transaction",
  },
  deleteTransaction: {
    kind: "write",
    running: "Deleting a transaction",
    done: "Deleted a transaction",
    target: "book_transaction",
    caution: "cannot-undo",
  },
  extractReceipt: {
    kind: "write",
    running: "Reading a receipt",
    done: "Read a receipt",
    target: "receipt_extraction",
  },
  createEarning: {
    kind: "write",
    running: "Logging drive earnings",
    done: "Logged drive earnings",
    target: "drive_earning",
  },
  createTrip: {
    kind: "write",
    running: "Logging a trip",
    done: "Logged a trip",
    target: "drive_trip",
  },
  createExpense: {
    kind: "write",
    running: "Logging a vehicle expense",
    done: "Logged a vehicle expense",
    target: "vehicle_expense",
  },
  sendInvoice: {
    kind: "write",
    running: "Sending an invoice",
    done: "Sent an invoice to the customer",
    target: "invoice",
    caution: "sends-message",
  },
  voidInvoice: {
    kind: "write",
    running: "Voiding an invoice",
    done: "Voided an invoice",
    target: "invoice",
    caution: "cannot-undo",
  },
  markInvoicePaid: {
    kind: "write",
    running: "Marking an invoice paid",
    done: "Marked an invoice paid",
    target: "invoice",
    caution: "sends-message",
  },
  convertQuoteToInvoice: {
    kind: "write",
    running: "Converting a quote to an invoice",
    done: "Created a draft invoice from a quote",
    target: "invoice",
  },
};

const UNKNOWN_TOOL: AssistantToolInfo = {
  kind: "write",
  running: "Working on an action",
  done: "Completed an action",
  target: "assistant_action",
};

/** Catalogue entry for a tool; an unlisted tool is treated as a write. */
export function assistantToolInfo(name: string): AssistantToolInfo {
  // `hasOwn`, so a name like "constructor" is not read off the object prototype.
  return Object.hasOwn(ASSISTANT_TOOLS, name) ? ASSISTANT_TOOLS[name]! : UNKNOWN_TOOL;
}

/** The fields the chat reads from a tool result to draw its card. All optional. */
export interface AssistantToolCardFields {
  /** A recoverable problem the tool reported instead of throwing. */
  error?: string;
  /** In-app link to the record or list the result is about. */
  href?: string;
  /** What the link opens, e.g. "INV-2026-0007" or "Acme Plumbing". */
  recordLabel?: string;
  /** List results: how many rows came back, and whether more matched than were returned. */
  returned?: number;
  hasMore?: boolean;
}

/** Read the card fields out of an unknown tool output without trusting its shape. */
export function readToolCardFields(output: unknown): AssistantToolCardFields {
  if (!output || typeof output !== "object" || Array.isArray(output)) return {};
  const record = output as Record<string, unknown>;
  const fields: AssistantToolCardFields = {};
  if (typeof record.error === "string" && record.error) fields.error = record.error;
  // Only same-app paths: a link in a card must never lead off-site.
  if (typeof record.href === "string" && /^\/(?!\/)/.test(record.href)) fields.href = record.href;
  if (typeof record.recordLabel === "string" && record.recordLabel) {
    fields.recordLabel = record.recordLabel.slice(0, 80);
  }
  if (typeof record.returned === "number" && Number.isFinite(record.returned)) {
    fields.returned = record.returned;
  }
  if (typeof record.hasMore === "boolean") fields.hasMore = record.hasMore;
  return fields;
}
