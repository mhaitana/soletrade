-- Atomic write RPCs (Phase 2 of the Drizzle -> Supabase migration).
--
-- PostgREST (the Supabase JS client) cannot run multi-statement transactions, so the
-- 7 sites that previously used `db.transaction(...)` become PL/pgSQL functions called
-- via `supabase.rpc(...)`. Each runs as a single atomic statement (its own transaction).
--
-- Design: pure calc (totals, per-line amountCents, number sequencing) stays in TS
-- (`computeInvoiceTotals`/`computeLineItemTotals`/`lineItemAmountCents`/`nextInvoiceNumber`);
-- the TS passes pre-computed values + line items (as jsonb) into these thin atomic
-- inserters/updaters. The 3x unique-number retry stays in JS - on a number collision
-- the unique index raises SQLSTATE 23505 and the JS retries.
--
-- `publishEvent` / `writeAudit` previously ran inside the transactions; after the port
-- they run AFTER the rpc returns (a tiny non-atomic gap between the row writes and the
-- event/audit rows). The event bus is best-effort and its consumers are idempotent, so
-- this is acceptable.
--
-- SECURITY DEFINER + SET search_path = public: run as the function owner (postgres) with
-- a fixed search_path, independent of the caller's role/search_path. There is no RLS in
-- this project; workspace scoping is enforced in app code (the TS passes workspace_id
-- resolved from the session, never from the client).

-- 1) create_workspace_with_owner ---------------------------------------------------
-- Insert a workspace + its owner membership atomically. Returns the new workspace id.
create function create_workspace_with_owner(
  p_owner_user_id uuid,
  p_name text,
  p_slug text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into workspaces (name, slug, owner_user_id)
    values (p_name, p_slug, p_owner_user_id)
    returning id into v_id;
  insert into workspace_members (workspace_id, user_id, role)
    values (v_id, p_owner_user_id, 'owner');
  return v_id;
end;
$$;

-- 2) accept_invitation --------------------------------------------------------------
-- Atomically validate + accept a pending invitation: lock the invite row, verify it is
-- pending/unexpired/addressed to this email, upsert the membership, mark the invitation
-- accepted. Returns (workspace_id, role, email) so the caller can publish the post-rpc
-- event/audit. Doing the validation inside the function closes the read-then-tx TOCTOU
-- the original Drizzle code had between the pre-tx select and the transaction.
create function accept_invitation(
  p_token text,
  p_user_id uuid,
  p_user_email text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_workspace_id uuid;
  v_role text;
  v_email text;
  v_expires_at timestamptz;
  v_accepted_at timestamptz;
  v_status text;
begin
  -- Lock the invitation row so two concurrent accepts can't both succeed.
  select id, workspace_id, role, email, expires_at, accepted_at, status
    into v_id, v_workspace_id, v_role, v_email, v_expires_at, v_accepted_at, v_status
    from workspace_invitations
    where token = p_token
    for update;

  if v_id is null or v_status <> 'pending' or v_accepted_at is not null then
    raise exception 'Invitation not found or already used.';
  end if;
  if v_expires_at < now() then
    raise exception 'Invitation has expired.';
  end if;
  if v_email <> lower(p_user_email) then
    raise exception 'This invitation was sent to a different email address.';
  end if;

  -- Upsert membership (idempotent if already a member). On conflict, restore the role +
  -- clear any soft-delete, mirroring the original onConflictDoUpdate. `role` is the
  -- `workspace_role` enum; `v_role` (read from the invitation as text) needs an explicit cast.
  insert into workspace_members (workspace_id, user_id, role)
    values (v_workspace_id, p_user_id, v_role::workspace_role)
    on conflict (workspace_id, user_id) do update
    set role = excluded.role,
        updated_at = now(),
        deleted_at = null;

  update workspace_invitations
    set status = 'accepted', accepted_at = now(), updated_at = now()
    where id = v_id;

  -- Return a jsonb object (no OUT params → no column-name collisions with the table
  -- columns read/written above). The caller reads workspace_id / role / email /
  -- invitation_id from this single object.
  return jsonb_build_object(
    'invitation_id', v_id,
    'workspace_id', v_workspace_id,
    'role', v_role,
    'email', v_email
  );
end;
$$;

-- 3) consume_credit -----------------------------------------------------------------
-- Consume credit against a charge, refusing to drive the workspace balance below zero.
-- The workspace row is locked FOR UPDATE so two concurrent consumers serialize: the
-- second waits for the first to commit, then sees the updated balance. Raises SQLSTATE
-- 45003 on insufficient credit so the caller can map it to InsufficientCreditError.
-- Returns (entry_id, balance_after). The caller pre-reads the balance for the error
-- snapshot; this function is the authoritative guard.
create function consume_credit(
  p_workspace_id uuid,
  p_amount_cents int,
  p_currency text,
  p_reason text,
  p_module_key text default null,
  p_actor_user_id uuid default null,
  p_stripe_invoice_id text default null,
  p_metadata jsonb default null
) returns table (entry_id uuid, balance_cents int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
  v_entry_id uuid;
begin
  if p_amount_cents <= 0 then
    raise exception 'consumeCredit requires a positive amount.';
  end if;

  -- Serialize concurrent credit consumption for this workspace.
  perform 1 from workspaces where id = p_workspace_id for update;

  select coalesce(sum(amount_cents), 0)::int into v_balance
    from credit_ledger
    where workspace_id = p_workspace_id and currency = p_currency;

  if v_balance - p_amount_cents < 0 then
    raise exception 'Insufficient credit' using errcode = '45003';
  end if;

  -- `module_key` is a Postgres enum column; a typed `text` param needs an explicit cast
  -- (string literals auto-cast, but params don't). NULL casts to NULL cleanly.
  insert into credit_ledger (
    workspace_id, entry_type, amount_cents, currency, reason,
    module_key, actor_user_id, stripe_invoice_id, metadata
  ) values (
    p_workspace_id, 'consumption', -p_amount_cents, p_currency, p_reason,
    p_module_key::module_key, p_actor_user_id, p_stripe_invoice_id, p_metadata
  )
  returning id into v_entry_id;

  return query select v_entry_id, v_balance - p_amount_cents;
end;
$$;

-- 4) create_invoice_with_lines ------------------------------------------------------
-- Insert a draft invoice + its line items atomically. All totals + the number + per-line
-- amountCents are pre-computed in TS. The unique index on (workspace_id, number) is the
-- race guard: a collision raises 23505, which the JS retries on. Returns the invoice id.
-- p_line_items is a jsonb array of {description, quantity, unit_price_cents, amount_cents, position}.
create function create_invoice_with_lines(
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
  p_line_items jsonb
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
    tax_rate, prices_include_tax, subtotal_cents, tax_cents, total_cents, notes
  ) values (
    p_workspace_id, p_customer_id, p_number, 'draft', p_issue_date, p_due_date, p_currency,
    p_tax_rate, p_prices_include_tax, p_subtotal_cents, p_tax_cents, p_total_cents, p_notes
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

-- 5) update_invoice_with_lines ------------------------------------------------------
-- Update a draft invoice atomically: lock the row, verify it belongs to the workspace and
-- is a draft, overlay the patch (p_set) via jsonb_populate_record (only keys present in
-- p_set change; a null value sets the column to null), optionally replace line items.
-- p_set: jsonb object of column -> value (snake_case), only the columns being changed.
-- p_line_items: jsonb array (replace) or null (keep existing).
-- Raises if not found or not a draft.
create function update_invoice_with_lines(
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

  -- Overlay only the keys present in p_set onto the row; untouched columns keep r's value.
  r := jsonb_populate_record(r, p_set);

  update invoices set
    customer_id      = r.customer_id,
    issue_date       = r.issue_date,
    due_date         = r.due_date,
    currency         = r.currency,
    tax_rate         = r.tax_rate,
    prices_include_tax = r.prices_include_tax,
    subtotal_cents   = r.subtotal_cents,
    tax_cents        = r.tax_cents,
    total_cents      = r.total_cents,
    notes            = r.notes,
    updated_at       = now()
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

-- 6) create_quote_with_lines -------------------------------------------------------
-- Insert a draft quote + its line items + optional sections atomically. Mirrors
-- create_invoice_with_lines, plus quote_sections. Returns the quote id.
-- p_line_items: jsonb array of {description, quantity, unit_price_cents, amount_cents, position}.
-- p_sections:   jsonb array of {title, body, position, optional} or null.
create function create_quote_with_lines(
  p_workspace_id uuid,
  p_customer_id uuid,
  p_number text,
  p_issue_date timestamptz,
  p_valid_until timestamptz,
  p_currency text,
  p_tax_rate int,
  p_prices_include_tax boolean,
  p_subtotal_cents int,
  p_tax_cents int,
  p_total_cents int,
  p_notes text,
  p_terms_conditions text,
  p_line_items jsonb,
  p_sections jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into quotes (
    workspace_id, customer_id, number, status, issue_date, valid_until, currency,
    tax_rate, prices_include_tax, subtotal_cents, tax_cents, total_cents, notes, terms_conditions
  ) values (
    p_workspace_id, p_customer_id, p_number, 'draft', p_issue_date, p_valid_until, p_currency,
    p_tax_rate, p_prices_include_tax, p_subtotal_cents, p_tax_cents, p_total_cents, p_notes, p_terms_conditions
  )
  returning id into v_id;

  insert into quote_line_items (quote_id, workspace_id, description, quantity, unit_price_cents, amount_cents, position)
  select
    v_id,
    p_workspace_id,
    rec ->> 'description',
    (rec ->> 'quantity')::numeric,
    (rec ->> 'unit_price_cents')::int,
    (rec ->> 'amount_cents')::int,
    (rec ->> 'position')::int
  from jsonb_array_elements(p_line_items) as rec;

  if p_sections is not null then
    insert into quote_sections (quote_id, workspace_id, title, body, position, optional)
    select
      v_id,
      p_workspace_id,
      rec ->> 'title',
      rec ->> 'body',
      (rec ->> 'position')::int,
      coalesce((rec ->> 'optional')::boolean, false)
    from jsonb_array_elements(p_sections) as rec;
  end if;

  return v_id;
end;
$$;

-- 7) update_quote_with_lines --------------------------------------------------------
-- Update a draft quote atomically: lock, verify draft, overlay p_set, optionally replace
-- line items and/or sections. Mirrors update_invoice_with_lines with sections added.
-- p_set: jsonb object of column -> value (snake_case), only changed columns.
-- p_line_items: jsonb array (replace) or null (keep).
-- p_sections:   jsonb array (replace) or null (keep). Pass '[]' to clear them.
create function update_quote_with_lines(
  p_workspace_id uuid,
  p_quote_id uuid,
  p_set jsonb,
  p_line_items jsonb,
  p_sections jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r quotes%rowtype;
begin
  select * into r from quotes where id = p_quote_id and workspace_id = p_workspace_id for update;
  if not found then
    raise exception 'Quote not found.';
  end if;
  if r.status <> 'draft' then
    raise exception 'Only draft quotes can be edited.';
  end if;

  r := jsonb_populate_record(r, p_set);

  update quotes set
    customer_id        = r.customer_id,
    issue_date         = r.issue_date,
    valid_until        = r.valid_until,
    currency           = r.currency,
    tax_rate           = r.tax_rate,
    prices_include_tax = r.prices_include_tax,
    subtotal_cents     = r.subtotal_cents,
    tax_cents          = r.tax_cents,
    total_cents        = r.total_cents,
    notes              = r.notes,
    terms_conditions   = r.terms_conditions,
    updated_at         = now()
  where id = p_quote_id;

  if p_line_items is not null then
    delete from quote_line_items where quote_id = p_quote_id;
    insert into quote_line_items (quote_id, workspace_id, description, quantity, unit_price_cents, amount_cents, position)
    select
      p_quote_id,
      p_workspace_id,
      rec ->> 'description',
      (rec ->> 'quantity')::numeric,
      (rec ->> 'unit_price_cents')::int,
      (rec ->> 'amount_cents')::int,
      (rec ->> 'position')::int
    from jsonb_array_elements(p_line_items) as rec;
  end if;

  if p_sections is not null then
    delete from quote_sections where quote_id = p_quote_id;
    insert into quote_sections (quote_id, workspace_id, title, body, position, optional)
    select
      p_quote_id,
      p_workspace_id,
      rec ->> 'title',
      rec ->> 'body',
      (rec ->> 'position')::int,
      coalesce((rec ->> 'optional')::boolean, false)
    from jsonb_array_elements(p_sections) as rec;
  end if;
end;
$$;