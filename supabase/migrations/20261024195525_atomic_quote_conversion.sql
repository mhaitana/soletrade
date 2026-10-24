-- Quote conversion is one financial operation, regardless of transport operation ID.
-- Nullable provenance preserves ordinary invoices and existing web create signatures.
alter table public.invoices add column source_quote_id uuid references public.quotes(id) on delete set null;
create unique index invoices_source_quote_unique on public.invoices(source_quote_id) where source_quote_id is not null;

-- Recover provenance from authoritative historical conversion links only. Never infer
-- a source from editable invoice notes or attach a cross-workspace invoice.
update public.invoices i set source_quote_id = q.id
from (
  select distinct on (converted_invoice_id) id, converted_invoice_id, workspace_id
  from public.quotes where converted_invoice_id is not null
  order by converted_invoice_id, id
) q
where i.id = q.converted_invoice_id and i.workspace_id = q.workspace_id;

create function public.convert_quote_to_invoice(
  p_workspace_id uuid,
  p_quote_id uuid,
  p_actor_id uuid,
  p_invoice_id uuid default null,
  p_expected_updated_at timestamptz default null,
  p_number_year int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  q quotes%rowtype;
  v_id uuid;
  v_prefix text;
  v_number text;
  v_year int := coalesce(p_number_year, extract(year from current_date)::int);
  v_sequence bigint;
  v_attempt int := 0;
  v_line_count int;
  v_meta jsonb;
begin
  -- Workspace lock serializes conversions/number allocation and billing projection;
  -- quote lock is the durable idempotency key across devices and operation IDs.
  select invoice_prefix into v_prefix from workspaces
    where id=p_workspace_id and deleted_at is null for update;
  if not found then raise exception 'Workspace unavailable.' using errcode='P0002'; end if;
  if not exists(select 1 from users where id=p_actor_id and deleted_at is null) or
     not exists(select 1 from workspace_members where workspace_id=p_workspace_id and user_id=p_actor_id
       and deleted_at is null and role in ('owner','admin','manager','accountant')) then
    raise exception 'Your role cannot convert quotes.' using errcode='42501';
  end if;
  if not exists(select 1 from module_installations where workspace_id=p_workspace_id and module_key='quotes' and status='active') or
     not exists(select 1 from module_installations where workspace_id=p_workspace_id and module_key='invoices' and status='active') then
    raise exception 'Quotes and Invoices modules must both be enabled.' using errcode='55000';
  end if;
  select * into q from quotes where id=p_quote_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Quote not found.' using errcode='P0002'; end if;
  if q.status='converted' and q.converted_invoice_id is not null then
    if not exists(select 1 from invoices where id=q.converted_invoice_id and workspace_id=p_workspace_id
      and source_quote_id=q.id) then
      raise exception 'The converted invoice is unavailable.' using errcode='55000';
    end if;
    return jsonb_build_object('invoiceId',q.converted_invoice_id,'created',false);
  end if;
  if q.status<>'accepted' then raise exception 'Only accepted quotes can be converted.' using errcode='55000'; end if;
  if p_expected_updated_at is not null and
     date_trunc('milliseconds',q.updated_at) <> date_trunc('milliseconds',p_expected_updated_at at time zone 'UTC') then
    raise exception 'Quote changed. Refresh before converting.' using errcode='40001';
  end if;
  if q.customer_id is not null and not exists(select 1 from customers where id=q.customer_id
    and workspace_id=p_workspace_id and deleted_at is null) then
    raise exception 'Customer not found in this workspace.' using errcode='55000';
  end if;
  select count(*) into v_line_count from quote_line_items where quote_id=q.id and workspace_id=p_workspace_id;
  if v_line_count=0 or exists(select 1 from quote_line_items where quote_id=q.id and workspace_id<>p_workspace_id) then
    raise exception 'A converted invoice needs valid quote line items.' using errcode='55000';
  end if;
  if v_year not between 1900 and 2200 then raise exception 'Invalid invoice number year.' using errcode='22023'; end if;
  v_id := coalesce(p_invoice_id, gen_random_uuid());
  if exists(select 1 from invoices where id=v_id) then
    raise exception 'Invoice identifier already used.' using errcode='23505';
  end if;
  v_prefix := coalesce(v_prefix,'INV-') || v_year::text || '-';
  select count(*)+1 into v_sequence from invoices where workspace_id=p_workspace_id
    and left(number,length(v_prefix))=v_prefix;
  loop
    v_attempt := v_attempt+1;
    v_number := v_prefix || lpad(v_sequence::text,greatest(4,length(v_sequence::text)),'0');
    begin
      -- Accepted documents have immutable canonical line amounts and totals; copying
      -- those snapshots avoids tax/decimal drift or trusting a client's new amounts.
      insert into invoices(id,workspace_id,source_quote_id,customer_id,number,status,issue_date,due_date,
        currency,tax_rate,prices_include_tax,subtotal_cents,tax_cents,total_cents,notes,payment_methods)
      values(v_id,p_workspace_id,q.id,q.customer_id,v_number,'draft',clock_timestamp() at time zone 'UTC',null,
        q.currency,q.tax_rate,q.prices_include_tax,q.subtotal_cents,q.tax_cents,q.total_cents,
        'Converted from quote ' || q.number || '.',null);
      exit;
    exception when unique_violation then
      -- A normal invoice create does not take this workspace lock. Retry ONLY a
      -- number collision, never hide an ID/provenance collision or allocate twice.
      if exists(select 1 from invoices where id=v_id or source_quote_id=q.id) or v_attempt>=64 then raise; end if;
      if not exists(select 1 from invoices where workspace_id=p_workspace_id and number=v_number) then raise; end if;
      v_sequence := v_sequence+1;
    end;
  end loop;
  insert into invoice_line_items(invoice_id,workspace_id,description,quantity,unit_price_cents,amount_cents,position)
    select v_id,p_workspace_id,description,quantity,unit_price_cents,amount_cents,position
    from quote_line_items where quote_id=q.id and workspace_id=p_workspace_id order by position,id;
  update quotes set status='converted',converted_invoice_id=v_id,
    converted_at=clock_timestamp() at time zone 'UTC',updated_at=clock_timestamp() at time zone 'UTC'
    where id=q.id and workspace_id=p_workspace_id;

  -- These two event types are activity-only (no email/payment subscribers). Persist
  -- their established metadata and audits here; JS must not publish them again.
  insert into activity_events(workspace_id,actor_user_id,type,entity_type,entity_id,metadata)
    values(p_workspace_id,p_actor_id,'InvoiceCreated','invoice',v_id,
      jsonb_build_object('number',v_number,'totalCents',q.total_cents));
  insert into audit_logs(workspace_id,actor_user_id,action,target_type,target_id,metadata)
    values(p_workspace_id,p_actor_id,'invoice.create','invoice',v_id,
      jsonb_build_object('number',v_number,'totalCents',q.total_cents,'lineItemCount',v_line_count));
  v_meta := jsonb_build_object('quoteNumber',q.number,'invoiceId',v_id,'invoiceNumber',v_number);
  insert into activity_events(workspace_id,actor_user_id,type,entity_type,entity_id,metadata)
    values(p_workspace_id,p_actor_id,'QuoteConvertedToInvoice','quote',q.id,v_meta);
  insert into audit_logs(workspace_id,actor_user_id,action,target_type,target_id,metadata)
    values(p_workspace_id,p_actor_id,'quote.convert','quote',q.id,v_meta);
  return jsonb_build_object('invoiceId',v_id,'created',true);
end $$;
revoke all on function public.convert_quote_to_invoice(uuid,uuid,uuid,uuid,timestamptz,int) from public,anon,authenticated;
grant execute on function public.convert_quote_to_invoice(uuid,uuid,uuid,uuid,timestamptz,int) to service_role;
