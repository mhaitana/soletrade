-- Durable cross-module Books synchronization.
--
-- The original integration used an in-process event bus. That remains useful for activity,
-- notifications, and audit side effects, but it is not a durable data-consistency boundary:
-- server instances can restart, bundles can have separate module state, and handlers
-- deliberately swallow failures. These database triggers make the source mutation and its
-- Books mirror one transaction. A workspace reconciliation function repairs historical gaps
-- and is run for every workspace that already has Books enabled, and whenever Books is enabled
-- later.

-- Existing source indexes were non-unique, so a handler race could create duplicate mirrors.
-- Keep the oldest row for each source before replacing the indexes with partial unique indexes.
with ranked as (
  select id,
         row_number() over (
           partition by workspace_id, source_invoice_id
           order by created_at, id
         ) as row_number
  from public.book_transactions
  where source_invoice_id is not null
)
delete from public.book_transactions
where id in (select id from ranked where row_number > 1);

with ranked as (
  select id,
         row_number() over (
           partition by workspace_id, source_earning_id
           order by created_at, id
         ) as row_number
  from public.book_transactions
  where source_earning_id is not null
)
delete from public.book_transactions
where id in (select id from ranked where row_number > 1);

with ranked as (
  select id,
         row_number() over (
           partition by workspace_id, source_expense_id
           order by created_at, id
         ) as row_number
  from public.book_transactions
  where source_expense_id is not null
)
delete from public.book_transactions
where id in (select id from ranked where row_number > 1);

with ranked as (
  select id,
         row_number() over (
           partition by workspace_id, source_trip_id
           order by created_at, id
         ) as row_number
  from public.book_transactions
  where source_trip_id is not null
)
delete from public.book_transactions
where id in (select id from ranked where row_number > 1);

drop index if exists public.book_transactions_workspace_source_invoice_idx;
drop index if exists public.book_transactions_workspace_source_earning_idx;
drop index if exists public.book_transactions_workspace_source_expense_idx;
drop index if exists public.book_transactions_workspace_source_trip_idx;

create unique index book_transactions_workspace_source_invoice_idx
  on public.book_transactions (workspace_id, source_invoice_id)
  where source_invoice_id is not null;
create unique index book_transactions_workspace_source_earning_idx
  on public.book_transactions (workspace_id, source_earning_id)
  where source_earning_id is not null;
create unique index book_transactions_workspace_source_expense_idx
  on public.book_transactions (workspace_id, source_expense_id)
  where source_expense_id is not null;
create unique index book_transactions_workspace_source_trip_idx
  on public.book_transactions (workspace_id, source_trip_id)
  where source_trip_id is not null;

create or replace function public.books_module_is_active(p_workspace_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.module_installations mi
    where mi.workspace_id = p_workspace_id
      and mi.module_key = 'books'
      and mi.status = 'active'
      and mi.cancelled_at is null
  );
$$;

-- Canonical label used by both reconciliation and row-level Drive triggers.
create or replace function public.drive_platform_display_name(p_platform text)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select case p_platform
    when 'uber' then 'Uber'
    when 'uber_eats' then 'Uber Eats'
    when 'doordash' then 'DoorDash'
    when 'airtasker' then 'Airtasker'
    when 'menulog' then 'Menulog'
    when 'lyft' then 'Lyft'
    when 'instacart' then 'Instacart'
    when 'other' then 'Other'
    else p_platform
  end;
$$;

create or replace function public.reconcile_books_workspace(p_workspace_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.books_module_is_active(p_workspace_id) then
    return;
  end if;

  -- Paid invoices are income on the payment date. Invoice GST is carried into Books so
  -- the BAS/tax view agrees with the invoice totals.
  insert into public.book_transactions (
    workspace_id, type, amount_cents, gst_cents, currency, date, description,
    category, customer_id, notes, source_invoice_id, updated_at
  )
  select
    i.workspace_id,
    'income'::public.book_type,
    i.total_cents,
    i.tax_cents,
    i.currency,
    coalesce(i.paid_at, i.updated_at),
    'Invoice ' || i.number,
    'invoice',
    case when c.id is not null and c.deleted_at is null then i.customer_id else null end,
    'Auto-recorded from invoice ' || i.number || '.',
    i.id,
    now()
  from public.invoices i
  left join public.customers c
    on c.id = i.customer_id and c.workspace_id = i.workspace_id
  where i.workspace_id = p_workspace_id
    and i.status = 'paid'
    and i.total_cents > 0
  on conflict (workspace_id, source_invoice_id) where source_invoice_id is not null
  do update set
    type = excluded.type,
    amount_cents = excluded.amount_cents,
    gst_cents = excluded.gst_cents,
    currency = excluded.currency,
    date = excluded.date,
    description = excluded.description,
    category = excluded.category,
    customer_id = excluded.customer_id,
    notes = excluded.notes,
    updated_at = now();

  delete from public.book_transactions bt
  where bt.workspace_id = p_workspace_id
    and bt.source_invoice_id is not null
    and not exists (
      select 1
      from public.invoices i
      where i.workspace_id = p_workspace_id
        and i.id = bt.source_invoice_id
        and i.status = 'paid'
        and i.total_cents > 0
    );

  -- Drive earnings are income on the user-selected earning date.
  insert into public.book_transactions (
    workspace_id, type, amount_cents, gst_cents, currency, date, description,
    category, customer_id, notes, source_earning_id, updated_at
  )
  select
    e.workspace_id,
    'income'::public.book_type,
    e.amount_cents,
    0,
    e.currency,
    e.date,
    'Drive earnings · ' || public.drive_platform_display_name(e.platform),
    'gig',
    null,
    'Auto-recorded from drive earnings (' || public.drive_platform_display_name(e.platform) || ').',
    e.id,
    now()
  from public.drive_earnings e
  where e.workspace_id = p_workspace_id
    and e.amount_cents > 0
  on conflict (workspace_id, source_earning_id) where source_earning_id is not null
  do update set
    type = excluded.type,
    amount_cents = excluded.amount_cents,
    gst_cents = excluded.gst_cents,
    currency = excluded.currency,
    date = excluded.date,
    description = excluded.description,
    category = excluded.category,
    customer_id = excluded.customer_id,
    notes = excluded.notes,
    updated_at = now();

  delete from public.book_transactions bt
  where bt.workspace_id = p_workspace_id
    and bt.source_earning_id is not null
    and not exists (
      select 1
      from public.drive_earnings e
      where e.workspace_id = p_workspace_id
        and e.id = bt.source_earning_id
        and e.amount_cents > 0
    );

  -- Vehicle expenses preserve their receipt link when mirrored into Books.
  insert into public.book_transactions (
    workspace_id, type, amount_cents, gst_cents, currency, date, description,
    category, customer_id, notes, source_expense_id, receipt_file_id, updated_at
  )
  select
    x.workspace_id,
    'expense'::public.book_type,
    x.amount_cents,
    0,
    x.currency,
    x.date,
    x.description,
    'vehicle_expense',
    null,
    'Auto-recorded from drive vehicle expense.',
    x.id,
    x.receipt_file_id,
    now()
  from public.driver_vehicle_expenses x
  where x.workspace_id = p_workspace_id
    and x.amount_cents > 0
  on conflict (workspace_id, source_expense_id) where source_expense_id is not null
  do update set
    type = excluded.type,
    amount_cents = excluded.amount_cents,
    gst_cents = excluded.gst_cents,
    currency = excluded.currency,
    date = excluded.date,
    description = excluded.description,
    category = excluded.category,
    customer_id = excluded.customer_id,
    notes = excluded.notes,
    receipt_file_id = excluded.receipt_file_id,
    updated_at = now();

  delete from public.book_transactions bt
  where bt.workspace_id = p_workspace_id
    and bt.source_expense_id is not null
    and not exists (
      select 1
      from public.driver_vehicle_expenses x
      where x.workspace_id = p_workspace_id
        and x.id = bt.source_expense_id
        and x.amount_cents > 0
    );

  -- Mileage follows the workspace's current rate. A zero rate means there is no expense
  -- row; changing the rate recalculates all mirrored trips via the profile trigger below.
  with trip_rows as (
    select
      t.*,
      round(
        (t.distance_meters::numeric / 1000) *
        coalesce(dp.mileage_rate_cents_per_km, 85)
      )::integer as deduction_cents,
      w.default_currency
    from public.drive_trips t
    join public.workspaces w on w.id = t.workspace_id
    left join public.driver_profiles dp on dp.workspace_id = t.workspace_id
    where t.workspace_id = p_workspace_id
  )
  insert into public.book_transactions (
    workspace_id, type, amount_cents, gst_cents, currency, date, description,
    category, customer_id, notes, source_trip_id, updated_at
  )
  select
    t.workspace_id,
    'expense'::public.book_type,
    t.deduction_cents,
    0,
    t.default_currency,
    t.date,
    'Drive mileage · ' || public.drive_platform_display_name(t.platform),
    'mileage',
    null,
    'Auto-recorded from drive mileage (' || public.drive_platform_display_name(t.platform) || ').',
    t.id,
    now()
  from trip_rows t
  where t.deduction_cents > 0
  on conflict (workspace_id, source_trip_id) where source_trip_id is not null
  do update set
    type = excluded.type,
    amount_cents = excluded.amount_cents,
    gst_cents = excluded.gst_cents,
    currency = excluded.currency,
    date = excluded.date,
    description = excluded.description,
    category = excluded.category,
    customer_id = excluded.customer_id,
    notes = excluded.notes,
    updated_at = now();

  delete from public.book_transactions bt
  where bt.workspace_id = p_workspace_id
    and bt.source_trip_id is not null
    and not exists (
      select 1
      from public.drive_trips t
      left join public.driver_profiles dp on dp.workspace_id = t.workspace_id
      where t.workspace_id = p_workspace_id
        and t.id = bt.source_trip_id
        and round(
          (t.distance_meters::numeric / 1000) *
          coalesce(dp.mileage_rate_cents_per_km, 85)
        )::integer > 0
    );
end;
$$;

create or replace function public.sync_invoice_to_books()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_workspace_id uuid := coalesce(new.workspace_id, old.workspace_id);
  v_customer_id uuid;
begin
  if not public.books_module_is_active(v_workspace_id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    delete from public.book_transactions
    where workspace_id = old.workspace_id and source_invoice_id = old.id;
    return old;
  end if;

  if new.status = 'paid' and new.total_cents > 0 then
    select c.id into v_customer_id
    from public.customers c
    where c.id = new.customer_id
      and c.workspace_id = new.workspace_id
      and c.deleted_at is null;

    insert into public.book_transactions (
      workspace_id, type, amount_cents, gst_cents, currency, date, description,
      category, customer_id, notes, source_invoice_id
    ) values (
      new.workspace_id,
      'income',
      new.total_cents,
      new.tax_cents,
      new.currency,
      coalesce(new.paid_at, new.updated_at),
      'Invoice ' || new.number,
      'invoice',
      v_customer_id,
      'Auto-recorded from invoice ' || new.number || '.',
      new.id
    )
    on conflict (workspace_id, source_invoice_id) where source_invoice_id is not null
    do update set
      type = excluded.type,
      amount_cents = excluded.amount_cents,
      gst_cents = excluded.gst_cents,
      currency = excluded.currency,
      date = excluded.date,
      description = excluded.description,
      category = excluded.category,
      customer_id = excluded.customer_id,
      notes = excluded.notes,
      updated_at = now();
  else
    delete from public.book_transactions
    where workspace_id = new.workspace_id and source_invoice_id = new.id;
  end if;

  return new;
end;
$$;

create or replace function public.sync_drive_earning_to_books()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_workspace_id uuid := coalesce(new.workspace_id, old.workspace_id);
  v_label text;
begin
  if not public.books_module_is_active(v_workspace_id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    delete from public.book_transactions
    where workspace_id = old.workspace_id and source_earning_id = old.id;
    return old;
  end if;

  v_label := public.drive_platform_display_name(new.platform);
  insert into public.book_transactions (
    workspace_id, type, amount_cents, gst_cents, currency, date, description,
    category, customer_id, notes, source_earning_id
  ) values (
    new.workspace_id,
    'income',
    new.amount_cents,
    0,
    new.currency,
    new.date,
    'Drive earnings · ' || v_label,
    'gig',
    null,
    'Auto-recorded from drive earnings (' || v_label || ').',
    new.id
  )
  on conflict (workspace_id, source_earning_id) where source_earning_id is not null
  do update set
    type = excluded.type,
    amount_cents = excluded.amount_cents,
    gst_cents = excluded.gst_cents,
    currency = excluded.currency,
    date = excluded.date,
    description = excluded.description,
    category = excluded.category,
    customer_id = excluded.customer_id,
    notes = excluded.notes,
    updated_at = now();

  return new;
end;
$$;

create or replace function public.sync_drive_expense_to_books()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_workspace_id uuid := coalesce(new.workspace_id, old.workspace_id);
begin
  if not public.books_module_is_active(v_workspace_id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    delete from public.book_transactions
    where workspace_id = old.workspace_id and source_expense_id = old.id;
    return old;
  end if;

  insert into public.book_transactions (
    workspace_id, type, amount_cents, gst_cents, currency, date, description,
    category, customer_id, notes, source_expense_id, receipt_file_id
  ) values (
    new.workspace_id,
    'expense',
    new.amount_cents,
    0,
    new.currency,
    new.date,
    new.description,
    'vehicle_expense',
    null,
    'Auto-recorded from drive vehicle expense.',
    new.id,
    new.receipt_file_id
  )
  on conflict (workspace_id, source_expense_id) where source_expense_id is not null
  do update set
    type = excluded.type,
    amount_cents = excluded.amount_cents,
    gst_cents = excluded.gst_cents,
    currency = excluded.currency,
    date = excluded.date,
    description = excluded.description,
    category = excluded.category,
    customer_id = excluded.customer_id,
    notes = excluded.notes,
    receipt_file_id = excluded.receipt_file_id,
    updated_at = now();

  return new;
end;
$$;

create or replace function public.sync_drive_trip_to_books()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_workspace_id uuid := coalesce(new.workspace_id, old.workspace_id);
  v_rate integer;
  v_amount integer;
  v_currency text;
  v_label text;
begin
  if not public.books_module_is_active(v_workspace_id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    delete from public.book_transactions
    where workspace_id = old.workspace_id and source_trip_id = old.id;
    return old;
  end if;

  select
    coalesce(dp.mileage_rate_cents_per_km, 85),
    w.default_currency
  into v_rate, v_currency
  from public.workspaces w
  left join public.driver_profiles dp on dp.workspace_id = w.id
  where w.id = new.workspace_id;

  v_amount := round((new.distance_meters::numeric / 1000) * v_rate)::integer;
  if v_amount <= 0 then
    delete from public.book_transactions
    where workspace_id = new.workspace_id and source_trip_id = new.id;
    return new;
  end if;

  v_label := public.drive_platform_display_name(new.platform);
  insert into public.book_transactions (
    workspace_id, type, amount_cents, gst_cents, currency, date, description,
    category, customer_id, notes, source_trip_id
  ) values (
    new.workspace_id,
    'expense',
    v_amount,
    0,
    v_currency,
    new.date,
    'Drive mileage · ' || v_label,
    'mileage',
    null,
    'Auto-recorded from drive mileage (' || v_label || ').',
    new.id
  )
  on conflict (workspace_id, source_trip_id) where source_trip_id is not null
  do update set
    type = excluded.type,
    amount_cents = excluded.amount_cents,
    gst_cents = excluded.gst_cents,
    currency = excluded.currency,
    date = excluded.date,
    description = excluded.description,
    category = excluded.category,
    customer_id = excluded.customer_id,
    notes = excluded.notes,
    updated_at = now();

  return new;
end;
$$;

create or replace function public.reconcile_books_on_module_enable()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.module_key = 'books'
     and new.status = 'active'
     and new.cancelled_at is null then
    if tg_op = 'INSERT' then
      perform public.reconcile_books_workspace(new.workspace_id);
    elsif old.status is distinct from new.status
       or old.cancelled_at is distinct from new.cancelled_at then
      perform public.reconcile_books_workspace(new.workspace_id);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.reconcile_books_on_mileage_rate_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or old.mileage_rate_cents_per_km is distinct from new.mileage_rate_cents_per_km then
    perform public.reconcile_books_workspace(new.workspace_id);
  end if;
  return new;
end;
$$;

create trigger invoices_sync_books
after insert or update or delete on public.invoices
for each row execute function public.sync_invoice_to_books();

create trigger drive_earnings_sync_books
after insert or update or delete on public.drive_earnings
for each row execute function public.sync_drive_earning_to_books();

create trigger drive_expenses_sync_books
after insert or update or delete on public.driver_vehicle_expenses
for each row execute function public.sync_drive_expense_to_books();

create trigger drive_trips_sync_books
after insert or update or delete on public.drive_trips
for each row execute function public.sync_drive_trip_to_books();

create trigger module_installations_reconcile_books
after insert or update on public.module_installations
for each row execute function public.reconcile_books_on_module_enable();

create trigger driver_profiles_reconcile_books
after insert or update on public.driver_profiles
for each row execute function public.reconcile_books_on_mileage_rate_change();

-- Trigger functions are internal implementation details, not Data API RPC endpoints.
revoke all on function public.books_module_is_active(uuid) from public, anon, authenticated;
revoke all on function public.drive_platform_display_name(text) from public, anon, authenticated;
revoke all on function public.reconcile_books_workspace(uuid) from public, anon, authenticated;
revoke all on function public.sync_invoice_to_books() from public, anon, authenticated;
revoke all on function public.sync_drive_earning_to_books() from public, anon, authenticated;
revoke all on function public.sync_drive_expense_to_books() from public, anon, authenticated;
revoke all on function public.sync_drive_trip_to_books() from public, anon, authenticated;
revoke all on function public.reconcile_books_on_module_enable() from public, anon, authenticated;
revoke all on function public.reconcile_books_on_mileage_rate_change() from public, anon, authenticated;

grant execute on function public.books_module_is_active(uuid) to service_role;
grant execute on function public.drive_platform_display_name(text) to service_role;
grant execute on function public.reconcile_books_workspace(uuid) to service_role;

-- Repair every workspace that already has Books active when this migration is deployed.
do $$
declare
  workspace record;
begin
  for workspace in
    select distinct mi.workspace_id
    from public.module_installations mi
    where mi.module_key = 'books'
      and mi.status = 'active'
      and mi.cancelled_at is null
  loop
    perform public.reconcile_books_workspace(workspace.workspace_id);
  end loop;
end;
$$;
