import { z } from "zod";
import type { Permission } from "@/lib/domain/permissions/index";
import type { ModuleKey } from "@/config/modules";

/**
 * hAI's safe client-side workflow contract.
 *
 * `openForm` never writes business data. It returns one of these validated
 * directives to the chat client, which stores it in sessionStorage and navigates
 * to the existing form. The form consumes the directive into local, unsaved state
 * and the user remains responsible for save/send/submit.
 *
 * Keeping every supported form in one registry makes the safety policy uniform:
 * per-form schemas reject unknown fields, module/permission gates are declared in
 * metadata, and no assistant-specific persistence path bypasses normal form actions.
 */

const shortText = z.string().trim().min(1).max(280);
const notesText = z.string().trim().max(2000);
const isoDate = z.string().date();
const moneyCents = z.number().int().min(0).max(1_000_000_000);
const positiveMoneyCents = moneyCents.min(1);
const positiveNumber = z.number().positive().max(1_000_000);

const customerFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email().max(320).optional(),
    phone: z.string().trim().max(50).optional(),
    company: z.string().trim().max(160).optional(),
    notes: notesText.optional(),
  })
  .strict();

const lineItemSchema = z
  .object({
    description: shortText.optional(),
    quantity: positiveNumber.optional(),
    unitPriceCents: moneyCents.optional(),
  })
  .strict();

const invoiceFieldsSchema = z
  .object({
    customerQuery: z.string().trim().min(1).max(320).optional(),
    issueDate: isoDate.optional(),
    dueDate: isoDate.optional(),
    taxRate: z.number().int().min(0).max(100).optional(),
    pricesIncludeTax: z.boolean().optional(),
    notes: notesText.optional(),
    lineItems: z.array(lineItemSchema).min(1).max(20).optional(),
  })
  .strict();

const quoteFieldsSchema = invoiceFieldsSchema.extend({
  validUntil: isoDate.optional(),
  termsConditions: z.string().trim().max(10_000).optional(),
});

const booksFieldsSchema = z
  .object({
    type: z.enum(["income", "expense"]).optional(),
    amountCents: positiveMoneyCents.optional(),
    date: isoDate.optional(),
    description: shortText.optional(),
    category: z.string().trim().min(1).max(80).optional(),
    customerQuery: z.string().trim().min(1).max(320).optional(),
    notes: notesText.optional(),
    gstIncluded: z.boolean().optional(),
    gstCents: moneyCents.optional(),
  })
  .strict();

const driveEarningFieldsSchema = z
  .object({
    platform: z.string().trim().min(1).max(50).optional(),
    amountCents: positiveMoneyCents.optional(),
    date: isoDate.optional(),
    description: shortText.optional(),
    notes: notesText.optional(),
  })
  .strict();

const driveTripFieldsSchema = z
  .object({
    platform: z.string().trim().min(1).max(50).optional(),
    distanceKm: positiveNumber.optional(),
    date: isoDate.optional(),
    purpose: shortText.optional(),
    notes: notesText.optional(),
  })
  .strict();

const driveExpenseFieldsSchema = z
  .object({
    vehicleQuery: z.string().trim().min(1).max(200).optional(),
    type: z.enum(["fuel", "maintenance", "insurance", "registration", "other"]).optional(),
    amountCents: positiveMoneyCents.optional(),
    date: isoDate.optional(),
    description: shortText.optional(),
    odometerKm: z.number().nonnegative().max(10_000_000).optional(),
    notes: notesText.optional(),
  })
  .strict();

const vehicleFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    make: z.string().trim().max(80).optional(),
    model: z.string().trim().max(80).optional(),
    year: z.number().int().min(1900).max(2200).optional(),
    odometerKm: z.number().nonnegative().max(10_000_000).optional(),
    active: z.boolean().optional(),
  })
  .strict();

const workspaceSettingsFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    defaultCurrency: z.string().trim().length(3).toUpperCase().optional(),
    invoicePrefix: z.string().trim().max(10).optional(),
    quotePrefix: z.string().trim().max(10).optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    fyStartMonth: z.number().int().min(1).max(12).optional(),
  })
  .strict();

const accountFieldsSchema = z
  .object({ fullName: z.string().trim().min(1).max(120).optional() })
  .strict();

const memberInviteFieldsSchema = z
  .object({
    email: z.string().trim().email().max(320).optional(),
    role: z.enum(["admin", "manager", "accountant", "employee", "readonly"]).optional(),
  })
  .strict();

const driveSettingsFieldsSchema = z
  .object({
    mileageRateCentsPerKm: z.number().int().min(0).max(10_000).optional(),
    defaultVehicleQuery: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const commonInput = {
  requestSummary: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .describe("A concise summary of what the user asked hAI to prepare."),
};

const createInput = <K extends string, S extends z.ZodType>(workflow: K, fields: S) =>
  z.object({ workflow: z.literal(workflow), fields, ...commonInput }).strict();

const editInput = <K extends string, S extends z.ZodType>(workflow: K, fields: S) =>
  z
    .object({
      workflow: z.literal(workflow),
      entityId: z.string().uuid(),
      fields,
      ...commonInput,
    })
    .strict();

export const haiOpenFormInputSchema = z.discriminatedUnion("workflow", [
  createInput("customer.create", customerFieldsSchema),
  editInput("customer.edit", customerFieldsSchema),
  createInput("invoice.create", invoiceFieldsSchema),
  editInput("invoice.edit", invoiceFieldsSchema),
  createInput("quote.create", quoteFieldsSchema),
  editInput("quote.edit", quoteFieldsSchema),
  createInput("books.transaction.create", booksFieldsSchema),
  editInput("books.transaction.edit", booksFieldsSchema),
  createInput("drive.earning.create", driveEarningFieldsSchema),
  editInput("drive.earning.edit", driveEarningFieldsSchema),
  createInput("drive.trip.create", driveTripFieldsSchema),
  editInput("drive.trip.edit", driveTripFieldsSchema),
  createInput("drive.expense.create", driveExpenseFieldsSchema),
  editInput("drive.expense.edit", driveExpenseFieldsSchema),
  createInput("drive.vehicle.create", vehicleFieldsSchema),
  editInput("drive.vehicle.edit", vehicleFieldsSchema),
  createInput("settings.general", workspaceSettingsFieldsSchema),
  createInput("settings.account", accountFieldsSchema),
  createInput("settings.member-invite", memberInviteFieldsSchema),
  createInput("drive.settings", driveSettingsFieldsSchema),
]);

export type HaiOpenFormInput = z.infer<typeof haiOpenFormInputSchema>;
export type HaiFormWorkflow = HaiOpenFormInput["workflow"];

type WorkflowMeta = {
  label: string;
  module?: ModuleKey;
  permission?: Permission;
  href: string | ((entityId: string) => string);
  fieldLabels: Record<string, string>;
  requiredOnCreate?: readonly string[];
};

export const HAI_FORM_WORKFLOWS: Record<HaiFormWorkflow, WorkflowMeta> = {
  "customer.create": {
    label: "New customer",
    permission: "manage:customer",
    href: "/customers/new",
    fieldLabels: {
      name: "customer name",
      email: "email",
      phone: "phone",
      company: "company",
      notes: "notes",
    },
    requiredOnCreate: ["name"],
  },
  "customer.edit": {
    label: "Edit customer",
    permission: "manage:customer",
    href: (id) => `/customers/${id}/edit`,
    fieldLabels: {
      name: "customer name",
      email: "email",
      phone: "phone",
      company: "company",
      notes: "notes",
    },
  },
  "invoice.create": {
    label: "New invoice",
    module: "invoices",
    permission: "create:invoice",
    href: "/invoices/new",
    fieldLabels: {
      customerQuery: "customer",
      issueDate: "issue date",
      dueDate: "due date",
      taxRate: "tax rate",
      pricesIncludeTax: "tax treatment",
      notes: "notes",
      lineItems: "line items",
    },
    requiredOnCreate: ["customerQuery", "lineItems"],
  },
  "invoice.edit": {
    label: "Edit invoice",
    module: "invoices",
    permission: "manage:invoice",
    href: (id) => `/invoices/${id}/edit`,
    fieldLabels: {
      customerQuery: "customer",
      issueDate: "issue date",
      dueDate: "due date",
      taxRate: "tax rate",
      pricesIncludeTax: "tax treatment",
      notes: "notes",
      lineItems: "line items",
    },
  },
  "quote.create": {
    label: "New quote",
    module: "quotes",
    permission: "create:quote",
    href: "/quotes/new",
    fieldLabels: {
      customerQuery: "customer",
      issueDate: "issue date",
      validUntil: "valid-until date",
      taxRate: "tax rate",
      pricesIncludeTax: "tax treatment",
      notes: "notes",
      termsConditions: "terms",
      lineItems: "line items",
    },
    requiredOnCreate: ["customerQuery", "lineItems"],
  },
  "quote.edit": {
    label: "Edit quote",
    module: "quotes",
    permission: "manage:quote",
    href: (id) => `/quotes/${id}/edit`,
    fieldLabels: {
      customerQuery: "customer",
      issueDate: "issue date",
      validUntil: "valid-until date",
      taxRate: "tax rate",
      pricesIncludeTax: "tax treatment",
      notes: "notes",
      termsConditions: "terms",
      lineItems: "line items",
    },
  },
  "books.transaction.create": {
    label: "New transaction",
    module: "books",
    permission: "manage:books",
    href: "/books/new",
    fieldLabels: {
      type: "transaction type",
      amountCents: "amount",
      date: "date",
      description: "description",
      category: "category",
      customerQuery: "customer",
      notes: "notes",
      gstIncluded: "GST treatment",
      gstCents: "GST amount",
    },
    requiredOnCreate: ["amountCents", "description"],
  },
  "books.transaction.edit": {
    label: "Edit transaction",
    module: "books",
    permission: "manage:books",
    href: (id) => `/books/${id}/edit`,
    fieldLabels: {
      type: "transaction type",
      amountCents: "amount",
      date: "date",
      description: "description",
      category: "category",
      customerQuery: "customer",
      notes: "notes",
      gstIncluded: "GST treatment",
      gstCents: "GST amount",
    },
  },
  "drive.earning.create": {
    label: "New Drive earning",
    module: "drive",
    permission: "manage:drive",
    href: "/drive/new?type=earning",
    fieldLabels: {
      platform: "platform",
      amountCents: "amount",
      date: "date",
      description: "description",
      notes: "notes",
    },
    requiredOnCreate: ["amountCents", "description"],
  },
  "drive.earning.edit": {
    label: "Edit Drive earning",
    module: "drive",
    permission: "manage:drive",
    href: (id) => `/drive/earnings/${id}/edit`,
    fieldLabels: {
      platform: "platform",
      amountCents: "amount",
      date: "date",
      description: "description",
      notes: "notes",
    },
  },
  "drive.trip.create": {
    label: "New mileage trip",
    module: "drive",
    permission: "manage:drive",
    href: "/drive/new?type=trip",
    fieldLabels: {
      platform: "platform",
      distanceKm: "distance",
      date: "date",
      purpose: "purpose",
      notes: "notes",
    },
    requiredOnCreate: ["distanceKm"],
  },
  "drive.trip.edit": {
    label: "Edit mileage trip",
    module: "drive",
    permission: "manage:drive",
    href: (id) => `/drive/trips/${id}/edit`,
    fieldLabels: {
      platform: "platform",
      distanceKm: "distance",
      date: "date",
      purpose: "purpose",
      notes: "notes",
    },
  },
  "drive.expense.create": {
    label: "Log vehicle expense",
    module: "drive",
    permission: "manage:drive",
    href: "/drive/expenses",
    fieldLabels: {
      vehicleQuery: "vehicle",
      type: "expense type",
      amountCents: "amount",
      date: "date",
      description: "description",
      odometerKm: "odometer",
      notes: "notes",
    },
    requiredOnCreate: ["vehicleQuery", "amountCents", "description"],
  },
  "drive.expense.edit": {
    label: "Edit vehicle expense",
    module: "drive",
    permission: "manage:drive",
    href: (id) => `/drive/expenses/${id}/edit`,
    fieldLabels: {
      vehicleQuery: "vehicle",
      type: "expense type",
      amountCents: "amount",
      date: "date",
      description: "description",
      odometerKm: "odometer",
      notes: "notes",
    },
  },
  "drive.vehicle.create": {
    label: "New vehicle",
    module: "drive",
    permission: "manage:drive",
    href: "/drive/vehicles/new",
    fieldLabels: {
      name: "vehicle name",
      make: "make",
      model: "model",
      year: "year",
      odometerKm: "odometer",
      active: "active status",
    },
    requiredOnCreate: ["name"],
  },
  "drive.vehicle.edit": {
    label: "Edit vehicle",
    module: "drive",
    permission: "manage:drive",
    href: (id) => `/drive/vehicles/${id}/edit`,
    fieldLabels: {
      name: "vehicle name",
      make: "make",
      model: "model",
      year: "year",
      odometerKm: "odometer",
      active: "active status",
    },
  },
  "settings.general": {
    label: "Workspace settings",
    permission: "update:workspace",
    href: "/settings",
    fieldLabels: {
      name: "workspace name",
      defaultCurrency: "default currency",
      invoicePrefix: "invoice prefix",
      quotePrefix: "quote prefix",
      timezone: "timezone",
      fyStartMonth: "financial-year start",
    },
  },
  "settings.account": {
    label: "Account profile",
    href: "/settings/account",
    fieldLabels: { fullName: "full name" },
  },
  "settings.member-invite": {
    label: "Invite a member",
    permission: "invite:member",
    href: "/settings/members",
    fieldLabels: { email: "email", role: "role" },
    requiredOnCreate: ["email"],
  },
  "drive.settings": {
    label: "Drive settings",
    module: "drive",
    permission: "manage:drive",
    href: "/drive/settings",
    fieldLabels: {
      mileageRateCentsPerKm: "mileage rate",
      defaultVehicleQuery: "default vehicle",
    },
  },
};

export const haiFormDirectiveSchema = z
  .object({
    id: z.string().uuid(),
    workflow: z.enum([
      "customer.create",
      "customer.edit",
      "invoice.create",
      "invoice.edit",
      "quote.create",
      "quote.edit",
      "books.transaction.create",
      "books.transaction.edit",
      "drive.earning.create",
      "drive.earning.edit",
      "drive.trip.create",
      "drive.trip.edit",
      "drive.expense.create",
      "drive.expense.edit",
      "drive.vehicle.create",
      "drive.vehicle.edit",
      "settings.general",
      "settings.account",
      "settings.member-invite",
      "drive.settings",
    ]),
    label: z.string().min(1).max(120),
    href: z.string().startsWith("/").max(500),
    requestSummary: z.string().min(1).max(240),
    fields: z.record(z.string(), z.unknown()),
    providedFields: z.array(z.string().min(1).max(120)).max(30),
    missingFields: z.array(z.string().min(1).max(120)).max(30),
    createdAt: z.number().int().positive(),
  })
  .strict();

export type HaiFormDirective = z.infer<typeof haiFormDirectiveSchema>;

function isProvided(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function createHaiFormDirective(input: HaiOpenFormInput): HaiFormDirective {
  const meta = HAI_FORM_WORKFLOWS[input.workflow];
  const fields = input.fields as Record<string, unknown>;
  const providedFields = Object.entries(fields)
    .filter(([, value]) => isProvided(value))
    .map(([key]) => meta.fieldLabels[key] ?? key);
  const missingFields = (meta.requiredOnCreate ?? [])
    .filter((key) => !isProvided(fields[key]))
    .map((key) => meta.fieldLabels[key] ?? key);
  const entityId = "entityId" in input ? input.entityId : undefined;
  const href = typeof meta.href === "function" ? meta.href(entityId ?? "") : meta.href;

  return haiFormDirectiveSchema.parse({
    id: crypto.randomUUID(),
    workflow: input.workflow,
    label: meta.label,
    href,
    requestSummary: input.requestSummary,
    fields,
    providedFields,
    missingFields,
    createdAt: Date.now(),
  });
}

export const HAI_PAGE_DESTINATION_KEYS = [
  "dashboard",
  "customers",
  "invoices",
  "invoices-overdue",
  "quotes",
  "quotes-accepted",
  "books",
  "books-receipts",
  "books-tax",
  "drive-earnings",
  "drive-trips",
  "drive-vehicles",
  "drive-expenses",
  "drive-settings",
  "files",
  "activity",
  "audit",
  "billing",
  "settings-general",
  "settings-modules",
  "settings-members",
  "settings-account",
  "assistant-history",
] as const;

export type HaiPageDestination = (typeof HAI_PAGE_DESTINATION_KEYS)[number];

type PageDestinationMeta = {
  label: string;
  href: string;
  module?: ModuleKey;
  permission?: Permission;
};

export const HAI_PAGE_DESTINATIONS: Record<HaiPageDestination, PageDestinationMeta> = {
  dashboard: { label: "Dashboard", href: "/dashboard" },
  customers: { label: "Customers", href: "/customers", permission: "view:customer" },
  invoices: {
    label: "Invoices",
    href: "/invoices",
    module: "invoices",
    permission: "view:invoice",
  },
  "invoices-overdue": {
    label: "Overdue invoices",
    href: "/invoices?status=overdue",
    module: "invoices",
    permission: "view:invoice",
  },
  quotes: { label: "Quotes", href: "/quotes", module: "quotes", permission: "view:quote" },
  "quotes-accepted": {
    label: "Accepted quotes",
    href: "/quotes?status=accepted",
    module: "quotes",
    permission: "view:quote",
  },
  books: { label: "Books", href: "/books", module: "books", permission: "view:books" },
  "books-receipts": {
    label: "Receipt review",
    href: "/books/receipts",
    module: "books",
    permission: "view:books",
  },
  "books-tax": {
    label: "Tax",
    href: "/books/tax",
    module: "books",
    permission: "view:books",
  },
  "drive-earnings": {
    label: "Drive earnings",
    href: "/drive",
    module: "drive",
    permission: "view:drive",
  },
  "drive-trips": {
    label: "Drive mileage",
    href: "/drive?view=trips",
    module: "drive",
    permission: "view:drive",
  },
  "drive-vehicles": {
    label: "Vehicles",
    href: "/drive/vehicles",
    module: "drive",
    permission: "view:drive",
  },
  "drive-expenses": {
    label: "Vehicle expenses",
    href: "/drive/expenses",
    module: "drive",
    permission: "view:drive",
  },
  "drive-settings": {
    label: "Drive settings",
    href: "/drive/settings",
    module: "drive",
    permission: "view:drive",
  },
  files: { label: "Files", href: "/files", permission: "view:file" },
  activity: { label: "Activity", href: "/activity", permission: "view:activity" },
  audit: { label: "Audit log", href: "/audit", permission: "view:audit" },
  billing: { label: "Billing", href: "/billing", permission: "view:billing" },
  "settings-general": { label: "Workspace settings", href: "/settings" },
  "settings-modules": { label: "Modules", href: "/settings/modules" },
  "settings-members": { label: "Members", href: "/settings/members", permission: "view:member" },
  "settings-account": { label: "Account", href: "/settings/account" },
  "assistant-history": { label: "hAI conversation history", href: "/assistant" },
};

export const haiNavigateInputSchema = z
  .object({ destination: z.enum(HAI_PAGE_DESTINATION_KEYS) })
  .strict();

export const haiNavigationDirectiveSchema = z
  .object({
    id: z.string().uuid(),
    destination: z.enum(HAI_PAGE_DESTINATION_KEYS),
    label: z.string().min(1).max(120),
    href: z.string().startsWith("/").max(500),
  })
  .strict();

export type HaiNavigationDirective = z.infer<typeof haiNavigationDirectiveSchema>;

export function createHaiNavigationDirective(
  destination: HaiPageDestination,
): HaiNavigationDirective {
  const meta = HAI_PAGE_DESTINATIONS[destination];
  return {
    id: crypto.randomUUID(),
    destination,
    label: meta.label,
    href: meta.href,
  };
}

export const HAI_FORM_TOOL_GUIDE = [
  "Use openForm for safe assisted drafting. It only opens an existing form and prefills unsaved fields; it never saves, sends, submits, or changes data.",
  "Supported workflows and allowed fields:",
  "customer.create/edit: name, email, phone, company, notes",
  "invoice.create/edit: customerQuery, issueDate, dueDate, taxRate, pricesIncludeTax, notes, lineItems[{description,quantity,unitPriceCents}]",
  "quote.create/edit: invoice fields plus validUntil and termsConditions",
  "books.transaction.create/edit: type, amountCents, date, description, category, customerQuery, notes, gstIncluded, gstCents",
  "drive.earning.create/edit: platform, amountCents, date, description, notes",
  "drive.trip.create/edit: platform, distanceKm, date, purpose, notes",
  "drive.expense.create/edit: vehicleQuery, type, amountCents, date, description, odometerKm, notes",
  "drive.vehicle.create/edit: name, make, model, year, odometerKm, active",
  "settings.general: name, defaultCurrency, invoicePrefix, quotePrefix, timezone, fyStartMonth",
  "settings.account: fullName; settings.member-invite: email, role; drive.settings: mileageRateCentsPerKm, defaultVehicleQuery",
  "For edit workflows, entityId is required. Only include a field when the user's wording or a read tool makes it reliable. Never guess missing values.",
].join("\n");

/**
 * Deterministic development fallback for the mock AI provider. It intentionally
 * recognises a narrow set of high-confidence commands; real providers use the
 * typed tools above. Keeping this conservative prevents the no-key dev path from
 * pretending to understand requests that it cannot safely extract.
 */
export function parseMockHaiAction(
  message: string,
):
  | { kind: "form"; input: HaiOpenFormInput }
  | { kind: "navigate"; destination: HaiPageDestination }
  | null {
  const text = message.trim();
  const lower = text.toLowerCase();
  const asksToStart = /\b(draft|prepare|start|create|make|add|log|record|new)\b/i.test(text);

  if (asksToStart && /\binvoice\b/i.test(text)) {
    const fields: z.infer<typeof invoiceFieldsSchema> = {};
    const exampleMatch = text.match(
      /\binvoice\s+(?:for|to)\s+(.+?)\s+for\s+(?:(?:aud|usd|nzd|gbp|eur)\s*)?\$?([\d,]+(?:\.\d{1,2})?)(?:\s|$)/i,
    );
    const amountMatch = text.match(/(?:(?:aud|usd|nzd|gbp|eur)\s*)?\$([\d,]+(?:\.\d{1,2})?)/i);
    if (exampleMatch?.[1]) fields.customerQuery = exampleMatch[1].trim();
    const amount = exampleMatch?.[2] ?? amountMatch?.[1];
    if (amount) {
      fields.lineItems = [
        { quantity: 1, unitPriceCents: Math.round(Number(amount.replaceAll(",", "")) * 100) },
      ];
    }
    return {
      kind: "form",
      input: {
        workflow: "invoice.create",
        requestSummary: text.slice(0, 240),
        fields,
      },
    };
  }

  if (asksToStart && /\bquote\b/i.test(text)) {
    return {
      kind: "form",
      input: { workflow: "quote.create", requestSummary: text.slice(0, 240), fields: {} },
    };
  }
  if (asksToStart && /\bcustomer\b/i.test(text)) {
    const email = text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0];
    return {
      kind: "form",
      input: {
        workflow: "customer.create",
        requestSummary: text.slice(0, 240),
        fields: email ? { email } : {},
      },
    };
  }
  if (asksToStart && /\b(expense|income|transaction)\b/i.test(text) && !/vehicle/i.test(text)) {
    const amount = text.match(/\$([\d,]+(?:\.\d{1,2})?)/)?.[1];
    return {
      kind: "form",
      input: {
        workflow: "books.transaction.create",
        requestSummary: text.slice(0, 240),
        fields: {
          ...(lower.includes("expense") ? { type: "expense" as const } : {}),
          ...(lower.includes("income") ? { type: "income" as const } : {}),
          ...(amount ? { amountCents: Math.round(Number(amount.replaceAll(",", "")) * 100) } : {}),
        },
      },
    };
  }
  if (asksToStart && /\b(mileage|trip)\b/i.test(text)) {
    const distance = text.match(/([\d.]+)\s*km\b/i)?.[1];
    return {
      kind: "form",
      input: {
        workflow: "drive.trip.create",
        requestSummary: text.slice(0, 240),
        fields: distance ? { distanceKm: Number(distance) } : {},
      },
    };
  }
  if (asksToStart && /\b(earning|earnings)\b/i.test(text)) {
    const amount = text.match(/\$([\d,]+(?:\.\d{1,2})?)/)?.[1];
    return {
      kind: "form",
      input: {
        workflow: "drive.earning.create",
        requestSummary: text.slice(0, 240),
        fields: amount ? { amountCents: Math.round(Number(amount.replaceAll(",", "")) * 100) } : {},
      },
    };
  }
  if (asksToStart && /\bvehicle\b/i.test(text)) {
    return {
      kind: "form",
      input: { workflow: "drive.vehicle.create", requestSummary: text.slice(0, 240), fields: {} },
    };
  }

  if (!/\b(open|go|show|take me|navigate)\b/i.test(text)) return null;
  const destinations: [RegExp, HaiPageDestination][] = [
    [/overdue invoice/i, "invoices-overdue"],
    [/accepted quote/i, "quotes-accepted"],
    [/receipt/i, "books-receipts"],
    [/\btax\b/i, "books-tax"],
    [/mileage|trips?/i, "drive-trips"],
    [/vehicle expenses?/i, "drive-expenses"],
    [/vehicles?/i, "drive-vehicles"],
    [/invoices?/i, "invoices"],
    [/quotes?/i, "quotes"],
    [/books?|transactions?/i, "books"],
    [/drive|earnings?/i, "drive-earnings"],
    [/customers?/i, "customers"],
    [/files?/i, "files"],
    [/activity/i, "activity"],
    [/audit/i, "audit"],
    [/billing/i, "billing"],
    [/members?/i, "settings-members"],
    [/modules?/i, "settings-modules"],
    [/account/i, "settings-account"],
    [/settings?/i, "settings-general"],
    [/dashboard|home/i, "dashboard"],
  ];
  const match = destinations.find(([pattern]) => pattern.test(text));
  return match ? { kind: "navigate", destination: match[1] } : null;
}
