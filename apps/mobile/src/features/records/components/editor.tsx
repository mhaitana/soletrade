import { DateField } from "@/components/date-field";
import { PaymentFields, validatePayments, type Payment } from "@/components/payment-methods";
import { ReferenceField } from "@/components/reference-field";
import {
  Action,
  Choice,
  Copy,
  ErrorNotice,
  Field,
  Group,
  Loading,
  Screen,
  Toggle,
  human,
} from "@/components/ui";
import { canWrite, catalog, defaultValues, formBody, toFormValues } from "@/config/resources";
import {
  correctRejectedDraft,
  createDraft,
  explicitSave,
  getDraft,
  listDrafts,
  syncOutbox,
  type Draft,
} from "@/lib/offline/store";
import { useResource, useWorkspacePath, type Entity } from "@/lib/resources";
import { useSession } from "@/lib/session";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";

export function EditorScreen() {
  const params = useLocalSearchParams<{
    resource: string;
    id: string;
    prefill?: string;
    draftId?: string;
  }>();
  const resource = decodeURIComponent(params.resource);
  const spec = catalog[resource];
  const editing = params.id !== "new";
  const { request, userId, workspaceId, bootstrap } = useSession();
  const path = useWorkspacePath(resource);
  const remote = useResource<Entity>(
    editing && path ? `${path}${spec?.singleton ? "" : `/${params.id}`}` : null,
  );
  const prefill = useMemo<Record<string, unknown>>(() => {
    try {
      return JSON.parse(params.prefill ?? "{}");
    } catch {
      return {};
    }
  }, [params.prefill]);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    toFormValues(resource, {
      ...defaultValues(resource),
      currency: bootstrap?.activeWorkspace?.settings.defaultCurrency ?? "AUD",
      ...prefill,
    }),
  );
  const hydrated = useRef(false);
  const [editSnapshot, setEditSnapshot] = useState<Entity | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [operationId] = useState(() => Crypto.randomUUID());
  const draft = useRef<Draft | null>(null);
  const [recovery, setRecovery] = useState<{ draftId: string; error?: string } | null>(null);
  useEffect(() => {
    if (!params.draftId) return;
    let live = true;
    const recoveryId = params.draftId;
    const load = async () => {
      try {
        const original = await getDraft({ userId, workspaceId }, recoveryId);
        if (original.userId !== userId || original.workspaceId !== workspaceId)
          throw new Error("This draft belongs to another account or workspace.");
        if (editing || !path || original.path !== path || original.kind !== resource)
          throw new Error(
            "This draft does not match this form. Open it from its original Drafts entry.",
          );
        if (
          original.status !== "blocked" ||
          !original.validationRejected ||
          original.uncertainOutcome !== false
        )
          throw new Error(
            "This draft cannot be corrected because its outcome is uncertain or it is no longer a rejected creation. Open Drafts to review it.",
          );
        if (!live) return;
        draft.current = original;
        setValues(toFormValues(resource, original.body));
        setRecovery({ draftId: recoveryId });
      } catch (cause) {
        if (live)
          setRecovery({
            draftId: recoveryId,
            error: cause instanceof Error ? cause.message : "Could not load the original draft.",
          });
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [params.draftId, editing, path, resource, userId, workspaceId]);
  // Hydrate a server-loaded edit form once its version arrives.
  useEffect(() => {
    if (remote.data && !hydrated.current) {
      hydrated.current = true;
      setEditSnapshot(remote.data);
      setValues(toFormValues(resource, { ...remote.data, ...prefill }));
    }
  }, [remote.data, resource, prefill]);
  const update = (key: string, value: unknown) =>
    setValues((previous) => ({ ...previous, [key]: value }));
  const save = async (body: Record<string, unknown>) => {
    if (busy || !path) return;
    setBusy(true);
    setError("");
    try {
      const offlineSupported =
        /^(customers|invoices|quotes|books\/transactions|drive\/(trips|earnings|expenses))$/.test(
          resource,
        );
      if (!editing && offlineSupported) {
        const binding = { userId, workspaceId };
        if (params.draftId) {
          if (!draft.current || recovery?.draftId !== params.draftId || recovery.error)
            throw new Error("Load the original rejected draft before saving corrections.");
          const corrected = await correctRejectedDraft(binding, params.draftId, body);
          if (
            corrected.id !== params.draftId ||
            corrected.userId !== userId ||
            corrected.workspaceId !== workspaceId ||
            corrected.path !== path ||
            corrected.kind !== resource
          )
            throw new Error(
              "The corrected draft no longer matches its original account, workspace or form.",
            );
          draft.current = corrected;
        } else draft.current ??= await createDraft({ ...binding, kind: resource, path, body });
        await explicitSave(binding, draft.current.id);
        await syncOutbox(binding, request);
        const current = (await listDrafts(binding)).find((item) => item.id === draft.current?.id);
        if (current?.status === "synced") {
          router.back();
          return;
        }
        Alert.alert(
          "Saved on this device",
          current?.error ?? "This record is queued. Open Drafts to review or retry when online.",
        );
        router.back();
      } else {
        await request(`${path}${editing && !spec.singleton ? `/${params.id}` : ""}`, {
          method: editing || spec.singleton ? "PATCH" : "POST",
          body:
            editing && resource === "drive/expenses"
              ? Object.fromEntries(Object.entries(body).filter(([key]) => key !== "vehicleId"))
              : body,
          idempotencyKey: operationId,
          version: editSnapshot?.updatedAt,
        });
        router.back();
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save. Your draft is still here.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (params.draftId && recovery?.draftId !== params.draftId)
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  if (params.draftId && recovery?.error)
    return (
      <Screen>
        <ErrorNotice message={recovery.error} />
      </Screen>
    );
  if (spec?.module && !bootstrap?.activeWorkspace?.modules.includes(spec.module))
    return (
      <Screen>
        <Copy>This module is not enabled for this workspace.</Copy>
      </Screen>
    );
  if (!spec)
    return (
      <Screen>
        <ErrorNotice message="This form could not be found." />
      </Screen>
    );
  if (
    !canWrite(
      bootstrap?.activeWorkspace?.capabilities ?? [],
      resource,
      editing ? "update" : "create",
    )
  )
    return (
      <Screen>
        <Copy>Your role cannot change this record.</Copy>
      </Screen>
    );
  if (editing && (remote.denied || (!editSnapshot && !remote.data)))
    return (
      <Screen>
        {remote.error ? (
          <ErrorNotice message={remote.error} retry={() => void remote.refresh()} />
        ) : (
          <Loading />
        )}
      </Screen>
    );
  return (
    <Screen>
      <Copy variant="title">
        {params.draftId ? "Correct rejected" : editing ? "Edit" : "New"} {spec.singular}
      </Copy>
      {params.draftId && (
        <Copy muted>
          Correct the original device draft. Its attachments stay with it. Save explicitly to queue
          the corrected record.
        </Copy>
      )}
      {error && <ErrorNotice message={error} />}
      {remote.cached && (
        <Copy muted>Showing a saved copy. Connect before editing this record.</Copy>
      )}
      {resource === "invoices" || resource === "quotes" ? (
        <DocumentForm
          resource={resource}
          initial={
            editSnapshot
              ? { ...editSnapshot, ...prefill }
              : remote.data
                ? { ...remote.data, ...prefill }
                : values
          }
          busy={busy}
          onSave={save}
        />
      ) : (
        <>
          <Group>
            {spec.fields?.map((field) => {
              const value = values[field.key];
              if (editing && resource === "drive/expenses" && field.key === "vehicleId")
                return (
                  <Copy key={field.key} muted>
                    Vehicle stays linked to the original expense.
                  </Copy>
                );
              if (field.reference)
                return (
                  <ReferenceField
                    key={field.key}
                    label={field.label}
                    resource={field.reference}
                    value={String(value ?? "")}
                    onChange={(value) => update(field.key, value)}
                  />
                );
              if (field.options) {
                let options = field.options;
                if (field.key === "category")
                  options =
                    values.type === "expense"
                      ? options.filter((value) =>
                          [
                            "rent",
                            "utilities",
                            "supplies",
                            "travel",
                            "wages",
                            "software_expense",
                            "vehicle_expense",
                            "mileage",
                            "other_expense",
                          ].includes(value),
                        )
                      : options.filter((value) =>
                          [
                            "sales",
                            "services",
                            "software",
                            "hardware",
                            "invoice",
                            "gig",
                            "other_income",
                          ].includes(value),
                        );
                return (
                  <Choice
                    key={field.key}
                    label={field.label}
                    value={String(value ?? "")}
                    options={options.map((value) => ({ label: human(value), value }))}
                    onChange={(value) => {
                      update(field.key, value);
                      if (field.key === "type")
                        update("category", value === "expense" ? "other_expense" : "sales");
                    }}
                  />
                );
              }
              if (field.kind === "toggle")
                return (
                  <Toggle
                    key={field.key}
                    label={field.label}
                    value={!!value}
                    onChange={(value) => update(field.key, value)}
                  />
                );
              if (field.kind === "date")
                return (
                  <DateField
                    key={field.key}
                    label={`${field.label}${field.required ? " *" : ""}`}
                    value={String(value ?? "")}
                    onChange={(value) => update(field.key, value)}
                  />
                );
              return (
                <Field
                  key={field.key}
                  label={`${field.label}${field.required ? " *" : ""}`}
                  value={String(value ?? "")}
                  onChangeText={(value) => update(field.key, value)}
                  multiline={field.kind === "multiline"}
                  keyboardType={
                    field.kind === "money" || field.kind === "number"
                      ? "decimal-pad"
                      : field.kind === "email"
                        ? "email-address"
                        : "default"
                  }
                  autoCapitalize={field.kind === "email" ? "none" : "sentences"}
                />
              );
            })}
          </Group>
          {resource === "settings" && (
            <PaymentFields
              workspaceDefault
              payments={Array.isArray(values.paymentMethods) ? values.paymentMethods : []}
              onChange={(value) => update("paymentMethods", value)}
            />
          )}
          <Action
            title="Save"
            busy={busy}
            onPress={() => {
              try {
                const body = formBody(resource, values);
                if (resource === "settings") {
                  const payments = Array.isArray(values.paymentMethods)
                    ? values.paymentMethods
                    : [];
                  validatePayments(payments);
                  body.paymentMethods = payments;
                }
                void save(body);
              } catch (cause) {
                setError(String(cause));
              }
            }}
          />
        </>
      )}
    </Screen>
  );
}

export type Line = { description: string; quantity: string; price: string };

export type Section = { title: string; body: string; optional: boolean };

export function documentBody(
  values: Record<string, unknown>,
  lines: Line[],
  sections: Section[],
  payments: Payment[],
  quote: boolean,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(values.issueDate)))
    throw new Error("Enter an issue date in YYYY-MM-DD format.");
  if (!lines.length) throw new Error("Add at least one line item.");
  const lineItems = lines.map((line, index) => {
    const quantity = Number(line.quantity),
      price = Number(line.price);
    if (
      !line.description.trim() ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(price) ||
      price < 0
    )
      throw new Error(`Check description, quantity and price on item ${index + 1}.`);
    return {
      description: line.description.trim(),
      quantity,
      unitPriceCents: Math.round(price * 100),
    };
  });
  if (!values.customerId) throw new Error("Select a customer before saving this document.");
  const taxRate = Number(values.taxRate);
  if (!Number.isInteger(taxRate) || taxRate < 0 || taxRate > 100)
    throw new Error("Tax rate must be a whole percent from 0 to 100.");
  const deadline = String(values.deadline ?? "").trim();
  if (deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || Number.isNaN(Date.parse(deadline))))
    throw new Error("Enter the due date in YYYY-MM-DD format.");
  for (const payment of payments) {
    if (
      payment.type === "bank_transfer" &&
      (!payment.accountName?.trim() || !payment.bsb?.trim() || !payment.accountNumber?.trim())
    )
      throw new Error("Complete the bank account name, BSB and account number.");
    if (payment.type === "paypal" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payment.email ?? ""))
      throw new Error("Enter a valid PayPal email.");
    if (payment.type === "payid" && !payment.identifier?.trim())
      throw new Error("Enter the PayID identifier.");
  }
  if (sections.some((section) => !section.title.trim() || !section.body.trim()))
    throw new Error("Give each quote section a title and content.");
  return {
    customerId: values.customerId || null,
    issueDate: `${values.issueDate}T00:00:00.000Z`,
    [quote ? "validUntil" : "dueDate"]: deadline ? `${deadline}T00:00:00.000Z` : null,
    currency: values.currency || "AUD",
    taxRate,
    pricesIncludeTax: !!values.pricesIncludeTax,
    notes: values.notes || null,
    lineItems,
    ...(quote
      ? { termsConditions: values.termsConditions || null, sections }
      : { paymentMethods: payments.length ? payments : null }),
  };
}

export function DocumentForm({
  resource,
  initial,
  busy,
  onSave,
}: {
  resource: string;
  initial: Record<string, unknown>;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const quote = resource === "quotes";
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...initial,
    issueDate: String(initial.issueDate ?? new Date().toISOString()).slice(0, 10),
    deadline: String(initial[quote ? "validUntil" : "dueDate"] ?? "").slice(0, 10),
    taxRate: initial.taxRate ?? "10",
    pricesIncludeTax: initial.pricesIncludeTax ?? false,
  }));
  const [lines, setLines] = useState<Line[]>(() =>
    Array.isArray(initial.lineItems)
      ? initial.lineItems.map((item) => ({
          description: String(item.description ?? ""),
          quantity: String(item.quantity ?? 1),
          price: item.unitPriceCents == null ? "" : String(Number(item.unitPriceCents) / 100),
        }))
      : [{ description: "", quantity: "1", price: "" }],
  );
  const [sections, setSections] = useState<Section[]>(() =>
    Array.isArray(initial.sections) ? initial.sections : [],
  );
  const [payments, setPayments] = useState<Payment[]>(() =>
    Array.isArray(initial.paymentMethods) ? initial.paymentMethods : [],
  );
  const [error, setError] = useState("");
  const update = (key: string, value: unknown) =>
    setValues((previous) => ({ ...previous, [key]: value }));
  const subtotal = lines.reduce(
    (sum, line) => sum + Math.round(Number(line.quantity || 0) * Number(line.price || 0) * 100),
    0,
  );
  const taxRate = Number(values.taxRate || 0);
  const tax = values.pricesIncludeTax
    ? Math.round((subtotal * taxRate) / (100 + taxRate))
    : Math.round((subtotal * taxRate) / 100);
  const total = values.pricesIncludeTax ? subtotal : subtotal + tax;
  return (
    <>
      <Group title="Customer and dates">
        {initial.customerQuery ? (
          <Copy muted>
            Suggested customer: {String(initial.customerQuery)}. Select the matching customer below.
          </Copy>
        ) : null}
        <ReferenceField
          label="Customer *"
          resource="customers"
          value={String(values.customerId ?? "")}
          onChange={(value) => update("customerId", value)}
        />
        <DateField
          label="Issue date *"
          value={String(values.issueDate)}
          onChange={(value) => update("issueDate", value)}
        />
        <DateField
          label={quote ? "Valid until" : "Due date"}
          value={String(values.deadline)}
          onChange={(value) => update("deadline", value)}
        />
        <Choice
          label="Currency"
          value={String(values.currency ?? "AUD")}
          options={["AUD", "NZD", "USD", "GBP", "EUR"].map((value) => ({ label: value, value }))}
          onChange={(value) => update("currency", value)}
        />
      </Group>
      <Group title="Line items">
        {lines.map((line, index) => (
          <Group key={index} title={`Item ${index + 1}`}>
            <Field
              label="Description *"
              value={line.description}
              onChangeText={(value) =>
                setLines((previous) =>
                  previous.map((item, i) => (i === index ? { ...item, description: value } : item)),
                )
              }
            />
            <Field
              label="Quantity *"
              keyboardType="decimal-pad"
              value={line.quantity}
              onChangeText={(value) =>
                setLines((previous) =>
                  previous.map((item, i) => (i === index ? { ...item, quantity: value } : item)),
                )
              }
            />
            <Field
              label="Unit price *"
              keyboardType="decimal-pad"
              value={line.price}
              onChangeText={(value) =>
                setLines((previous) =>
                  previous.map((item, i) => (i === index ? { ...item, price: value } : item)),
                )
              }
            />
            <Action
              title={`Remove item ${index + 1}`}
              secondary
              onPress={() => setLines((previous) => previous.filter((_, i) => i !== index))}
            />
          </Group>
        ))}
        <Action
          title="Add line item"
          secondary
          onPress={() =>
            setLines((previous) => [...previous, { description: "", quantity: "1", price: "" }])
          }
        />
      </Group>
      <Group title="Tax and totals">
        <Field
          label="GST / tax rate (%)"
          value={String(values.taxRate)}
          keyboardType="number-pad"
          onChangeText={(value) => update("taxRate", value)}
        />
        <Toggle
          label="Prices include tax"
          value={!!values.pricesIncludeTax}
          onChange={(value) => update("pricesIncludeTax", value)}
        />
        <Copy>Tax: {(tax / 100).toFixed(2)}</Copy>
        <Copy variant="title">
          Total: {(total / 100).toFixed(2)} {String(values.currency ?? "AUD")}
        </Copy>
      </Group>
      {quote ? (
        <Group title="Proposal">
          <Field
            label="Terms and conditions"
            multiline
            value={String(values.termsConditions ?? "")}
            onChangeText={(value) => update("termsConditions", value)}
          />
          {sections.map((section, index) => (
            <Group key={index} title={`Section ${index + 1}`}>
              <Field
                label="Section title"
                value={section.title}
                onChangeText={(value) =>
                  setSections((previous) =>
                    previous.map((item, i) => (i === index ? { ...item, title: value } : item)),
                  )
                }
              />
              <Field
                label="Content"
                multiline
                value={section.body}
                onChangeText={(value) =>
                  setSections((previous) =>
                    previous.map((item, i) => (i === index ? { ...item, body: value } : item)),
                  )
                }
              />
              <Toggle
                label="Optional for customer"
                value={section.optional}
                onChange={(value) =>
                  setSections((previous) =>
                    previous.map((item, i) => (i === index ? { ...item, optional: value } : item)),
                  )
                }
              />
              <Action
                title={`Remove section ${index + 1}`}
                secondary
                onPress={() => setSections((previous) => previous.filter((_, i) => i !== index))}
              />
            </Group>
          ))}
          <Action
            title="Add proposal section"
            secondary
            onPress={() =>
              setSections((previous) => [...previous, { title: "", body: "", optional: false }])
            }
          />
        </Group>
      ) : (
        <PaymentFields payments={payments} onChange={setPayments} />
      )}
      <Group>
        <Field
          label="Notes"
          multiline
          value={String(values.notes ?? "")}
          onChangeText={(value) => update("notes", value)}
        />
      </Group>
      {error && <ErrorNotice message={error} />}
      <Action
        title="Save draft"
        busy={busy}
        onPress={() => {
          try {
            const body = documentBody(values, lines, sections, payments, quote);
            setError("");
            void onSave(body);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Check the form.");
          }
        }}
      />
    </>
  );
}
