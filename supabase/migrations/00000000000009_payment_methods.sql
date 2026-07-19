-- Payment details on invoices (F001).
--
-- Merchants configure a default list of payment methods at the workspace level and
-- optionally override them per invoice. The list is stored as jsonb because each method
-- type carries a different set of fields (bank transfer has BSB/account number, PayPal
-- has an email, PayID has an identifier). The application validates the shape with Zod at
-- every boundary; the database only enforces that the value, when present, is valid json.

ALTER TABLE "workspaces" ADD COLUMN "payment_methods" jsonb;
ALTER TABLE "invoices" ADD COLUMN "payment_methods" jsonb;

-- Extend the atomic invoice creator to persist the optional per-invoice payment methods
-- in the same insert as the invoice + line items. Drop the old overload so the new
-- signature is the only one and generated Supabase types stay unambiguous.
drop function if exists create_invoice_with_lines(
  uuid, uuid, text, timestamptz, timestamptz, text, int, boolean, int, int, int, text, jsonb
);

create or replace function create_invoice_with_lines(
  p_workspace_id uuid,
  p_customer_id uuid,
  p_number text,
  p_issue_date timestamptz,
  p_due_date timestamptz,
  p_currency text,
  p_tax_rate int,
  p_prices_include_tax boolean,
  p_subtotal_cents int,
  p_tax_cents int,
  p_total_cents int,
  p_notes text,
  p_line_items jsonb,
  p_payment_methods jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into invoices (
    workspace_id, customer_id, number, status, issue_date, due_date, currency,
    tax_rate, prices_include_tax, subtotal_cents, tax_cents, total_cents, notes, payment_methods
  ) values (
    p_workspace_id, p_customer_id, p_number, 'draft', p_issue_date, p_due_date, p_currency,
    p_tax_rate, p_prices_include_tax, p_subtotal_cents, p_tax_cents, p_total_cents, p_notes, p_payment_methods
  )
  returning id into v_id;

  insert into invoice_line_items (invoice_id, workspace_id, description, quantity, unit_price_cents, amount_cents, position)
  select
    v_id,
    p_workspace_id,
    rec ->> 'description',
    (rec ->> 'quantity')::numeric,
    (rec ->> 'unit_price_cents')::int,
    (rec ->> 'amount_cents')::int,
    (rec ->> 'position')::int
  from jsonb_array_elements(p_line_items) as rec;

  return v_id;
end;
$$;

-- Extend atomic invoice updater to persist optional per-invoice payment methods.
create or replace function update_invoice_with_lines(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_set jsonb,
  p_line_items jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r invoices%rowtype;
begin
  select * into r from invoices where id = p_invoice_id and workspace_id = p_workspace_id for update;
  if not found then
    raise exception 'Invoice not found.';
  end if;
  if r.status <> 'draft' then
    raise exception 'Only draft invoices can be edited.';
  end if;

  r := jsonb_populate_record(r, p_set);

  update invoices set
    customer_id        = r.customer_id,
    issue_date         = r.issue_date,
    due_date           = r.due_date,
    currency           = r.currency,
    tax_rate           = r.tax_rate,
    prices_include_tax = r.prices_include_tax,
    subtotal_cents     = r.subtotal_cents,
    tax_cents          = r.tax_cents,
    total_cents        = r.total_cents,
    notes              = r.notes,
    payment_methods    = r.payment_methods,
    updated_at         = now()
  where id = p_invoice_id;

  if p_line_items is not null then
    delete from invoice_line_items where invoice_id = p_invoice_id;
    insert into invoice_line_items (invoice_id, workspace_id, description, quantity, unit_price_cents, amount_cents, position)
    select
      p_invoice_id,
      p_workspace_id,
      rec ->> 'description',
      (rec ->> 'quantity')::numeric,
      (rec ->> 'unit_price_cents')::int,
      (rec ->> 'amount_cents')::int,
      (rec ->> 'position')::int
    from jsonb_array_elements(p_line_items) as rec;
  end if;
end;
$$;
