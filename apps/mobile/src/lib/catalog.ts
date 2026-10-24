export type FieldSpec = {
  key: string;
  label: string;
  kind?: "money" | "number" | "date" | "email" | "multiline" | "toggle";
  required?: boolean;
  options?: readonly string[];
  reference?: string;
};
export type ResourceSpec = {
  title: string;
  singular: string;
  module?: "invoices" | "quotes" | "books" | "drive";
  permission?: string;
  fields?: FieldSpec[];
  readOnly?: boolean;
  statuses?: string[];
  singleton?: boolean;
};
const date: FieldSpec = { key: "date", label: "Date", kind: "date", required: true };
const notes: FieldSpec = { key: "notes", label: "Notes", kind: "multiline" };
const currencyField: FieldSpec = {
  key: "currency",
  label: "Currency",
  required: true,
  options: ["AUD", "NZD", "USD", "GBP", "EUR"],
};
const amount: FieldSpec = {
  key: "amountCents",
  label: "Amount",
  kind: "money",
  required: true,
};
const description: FieldSpec = { key: "description", label: "Description", required: true };
const platform: FieldSpec = {
  key: "platform",
  label: "Platform",
  required: true,
  options: ["uber", "uber_eats", "doordash", "airtasker", "menulog", "lyft", "instacart", "other"],
};
export const catalog: Record<string, ResourceSpec> = {
  customers: {
    title: "Customers",
    singular: "customer",
    permission: "customer",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "email", label: "Email", kind: "email" },
      { key: "phone", label: "Phone" },
      { key: "company", label: "Company" },
      notes,
    ],
  },
  invoices: {
    title: "Invoices",
    singular: "invoice",
    module: "invoices",
    permission: "invoice",
    statuses: ["draft", "sent", "viewed", "overdue", "paid", "void"],
  },
  quotes: {
    title: "Quotes",
    singular: "quote",
    module: "quotes",
    permission: "quote",
    statuses: ["draft", "sent", "viewed", "accepted", "declined", "expired", "converted"],
  },
  "books/transactions": {
    title: "Transactions",
    singular: "transaction",
    module: "books",
    permission: "books",
    fields: [
      { key: "type", label: "Type", required: true, options: ["income", "expense"] },
      currencyField,
      amount,
      { key: "gstCents", label: "GST included", kind: "money" },
      date,
      description,
      {
        key: "category",
        label: "Category",
        required: true,
        options: [
          "sales",
          "services",
          "software",
          "hardware",
          "invoice",
          "gig",
          "other_income",
          "rent",
          "utilities",
          "supplies",
          "travel",
          "wages",
          "software_expense",
          "vehicle_expense",
          "mileage",
          "other_expense",
        ],
      },
      { key: "customerId", label: "Customer", reference: "customers" },
      notes,
    ],
  },
  "books/receipts": {
    title: "Receipts",
    singular: "receipt",
    module: "books",
    readOnly: true,
    statuses: ["pending", "reviewed", "applied", "rejected"],
  },
  "drive/earnings": {
    title: "Earnings",
    singular: "earning",
    module: "drive",
    permission: "drive",
    fields: [platform, currencyField, amount, date, description, notes],
  },
  "drive/trips": {
    title: "Mileage",
    singular: "trip",
    module: "drive",
    permission: "drive",
    fields: [
      platform,
      { key: "vehicleId", label: "Vehicle", reference: "drive/vehicles" },
      { key: "distanceMeters", label: "Distance (km)", kind: "number", required: true },
      date,
      { key: "purpose", label: "Business purpose", required: true },
      notes,
    ],
  },
  "drive/vehicles": {
    title: "Vehicles",
    singular: "vehicle",
    module: "drive",
    permission: "drive",
    fields: [
      { key: "name", label: "Vehicle name", required: true },
      { key: "make", label: "Make" },
      { key: "model", label: "Model" },
      { key: "year", label: "Year", kind: "number" },
      { key: "odometerKm", label: "Odometer (km)", kind: "number" },
      { key: "active", label: "Active vehicle", kind: "toggle" },
    ],
  },
  "drive/expenses": {
    title: "Vehicle expenses",
    singular: "expense",
    module: "drive",
    permission: "drive",
    fields: [
      { key: "vehicleId", label: "Vehicle", reference: "drive/vehicles", required: true },
      {
        key: "type",
        label: "Expense type",
        options: ["fuel", "maintenance", "insurance", "registration", "other"],
        required: true,
      },
      currencyField,
      amount,
      date,
      description,
      { key: "odometerKm", label: "Odometer (km)", kind: "number" },
      notes,
    ],
  },
  "drive/settings": {
    title: "Drive settings",
    singular: "Drive settings",
    module: "drive",
    permission: "drive",
    singleton: true,
    fields: [
      {
        key: "mileageRateCentsPerKm",
        label: "Mileage rate (AUD per km)",
        kind: "money",
        required: true,
      },
      { key: "defaultVehicleId", label: "Default vehicle", reference: "drive/vehicles" },
    ],
  },
  files: {
    title: "Files",
    singular: "file",
    permission: "file",
    fields: [{ key: "name", label: "File name", required: true }],
  },
  activity: { title: "Activity", singular: "activity", readOnly: true },
  audit: { title: "Audit trail", singular: "audit event", readOnly: true },
  notifications: { title: "Notifications", singular: "notification", readOnly: true },
  members: {
    title: "Team",
    singular: "member",
    permission: "member",
    fields: [
      {
        key: "role",
        label: "Role",
        required: true,
        options: ["admin", "manager", "accountant", "employee", "readonly"],
      },
    ],
  },
  invitations: {
    title: "Invitations",
    singular: "invitation",
    permission: "member",
    fields: [
      { key: "email", label: "Email", kind: "email", required: true },
      {
        key: "role",
        label: "Role",
        required: true,
        options: ["admin", "manager", "accountant", "employee", "readonly"],
      },
    ],
  },
  settings: {
    title: "Business settings",
    singular: "settings",
    permission: "workspace",
    singleton: true,
    fields: [
      { key: "name", label: "Business name", required: true },
      {
        key: "defaultCurrency",
        label: "Currency",
        required: true,
        options: ["AUD", "NZD", "USD", "GBP", "EUR"],
      },
      { key: "timezone", label: "Timezone", required: true },
      { key: "invoicePrefix", label: "Invoice prefix", required: true },
      { key: "quotePrefix", label: "Quote prefix", required: true },
      {
        key: "fyStartMonth",
        label: "Financial year starts in month",
        kind: "number",
        required: true,
      },
    ],
  },
};
export function canWrite(capabilities: string[], resource: string, operation = "create") {
  const spec = catalog[resource];
  return (
    !spec?.readOnly &&
    !!spec?.permission &&
    (capabilities.includes(`${operation}:${spec.permission}`) ||
      capabilities.includes(`manage:${spec.permission}`) ||
      (operation === "create" &&
        resource === "invitations" &&
        capabilities.includes("invite:member")) ||
      capabilities.includes("*"))
  );
}
export function defaultValues(resource: string): Record<string, unknown> {
  const today = new Date().toISOString().slice(0, 10);
  const base: Record<string, unknown> = {};
  for (const field of catalog[resource]?.fields ?? [])
    base[field.key] =
      field.kind === "date" ? today : field.kind === "toggle" ? true : (field.options?.[0] ?? "");
  if (resource === "settings")
    Object.assign(base, {
      defaultCurrency: "AUD",
      timezone: "Australia/Melbourne",
      invoicePrefix: "INV-",
      quotePrefix: "QUO-",
      fyStartMonth: "7",
    });
  return base;
}
export function toFormValues(resource: string, entity: Record<string, unknown>) {
  const result = { ...entity };
  for (const field of catalog[resource]?.fields ?? []) {
    const value = entity[field.key];
    if (field.kind === "money" && value != null) result[field.key] = String(Number(value) / 100);
    if (field.kind === "date" && typeof value === "string") result[field.key] = value.slice(0, 10);
    if (field.key === "distanceMeters" && value != null)
      result[field.key] = String(Number(value) / 1000);
  }
  return result;
}
export function formBody(resource: string, values: Record<string, unknown>) {
  const body: Record<string, unknown> = {};
  for (const field of catalog[resource]?.fields ?? []) {
    const value = values[field.key];
    const text = String(value ?? "").trim();
    if (field.required && !text) throw new Error(`${field.label} is required.`);
    if (field.kind === "email" && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))
      throw new Error("Enter a valid email address.");
    if (field.kind === "toggle") body[field.key] = !!value;
    else if (field.kind === "money" || field.kind === "number") {
      if (!text) {
        body[field.key] = field.kind === "money" ? 0 : null;
        continue;
      }
      const number = Number(text);
      if (
        !Number.isFinite(number) ||
        number < 0 ||
        ((field.key === "amountCents" || field.key === "distanceMeters") && number <= 0)
      )
        throw new Error(`${field.label} must be a positive number.`);
      body[field.key] =
        field.kind === "money"
          ? Math.round(number * 100)
          : field.key === "distanceMeters"
            ? Math.round(number * 1000)
            : number;
    } else if (field.kind === "date") {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
        Number.isNaN(Date.parse(text)) ||
        new Date(text).toISOString().slice(0, 10) !== text
      )
        throw new Error("Use dates in YYYY-MM-DD format.");
      body[field.key] = `${text}T00:00:00.000Z`;
    } else body[field.key] = text || null;
  }
  return body;
}
