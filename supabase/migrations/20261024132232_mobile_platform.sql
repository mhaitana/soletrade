-- Mobile additions are additive; no existing business records or prices change.
alter table public.files add column upload_status text not null default 'complete'
  check (upload_status in ('pending', 'complete'));
alter table public.receipt_extractions add column processing boolean not null default false;
alter table public.drive_trips add column vehicle_id uuid references public.vehicles(id) on delete set null;

create table public.mobile_api_operations (
  id uuid primary key, user_id uuid not null references public.users(id),
  workspace_id uuid references public.workspaces(id), operation text not null,
  fingerprint text not null, status text not null default 'processing' check(status in ('processing','complete')),
  response jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index mobile_operations_user on public.mobile_api_operations(user_id, created_at);
create table public.mobile_preferences (
  user_id uuid primary key references public.users(id), route_sync_enabled boolean not null default false,
  quiet_hours_start int not null default 22 check(quiet_hours_start between 0 and 23),
  quiet_hours_end int not null default 7 check(quiet_hours_end between 0 and 23),
  notification_categories text[] not null default array['payments','quotes','receipts','reminders'],
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.mobile_devices (
  id text not null, user_id uuid not null references public.users(id), token text not null unique,
  platform text not null check(platform in ('ios','android')), timezone text not null,
  enabled boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(user_id,id)
);
create table public.mobile_routes (
  id uuid primary key, recorder_id uuid not null references public.users(id), workspace_id uuid not null references public.workspaces(id),
  trip_id uuid not null references public.drive_trips(id) on delete cascade,
  started_at timestamptz not null, ended_at timestamptz not null, distance_meters int not null check(distance_meters>=0),
  points jsonb not null, deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(ended_at>=started_at)
);
create index mobile_routes_recorder_sync on public.mobile_routes(recorder_id,updated_at);
create table public.billing_contracts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
  owner_user_id uuid references public.users(id), provider text not null check(provider in ('stripe','apple','google')),
  external_id text not null, product_key text not null, modules text[] not null default '{}', interval text not null,
  status text not null, paid_through timestamptz, grace_until timestamptz, pending_modules text[], pending_interval text, renews boolean not null default true,
  environment text not null, verified_at timestamptz not null default now(), verification_revision bigint not null default 0, last_verification_attempt_at timestamptz, current boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(provider,environment,external_id)
);
create unique index billing_contract_current on public.billing_contracts(workspace_id) where current;
alter table public.module_installations add column billing_contract_id uuid references public.billing_contracts(id);
create table public.store_workspace_bindings (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
  workspace_id uuid not null references public.workspaces(id), provider text not null,
  external_id text not null, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(provider,external_id)
);
create unique index store_binding_user_active on public.store_workspace_bindings(user_id) where active;
create unique index store_binding_workspace_active on public.store_workspace_bindings(workspace_id) where active;
-- A purchase sheet can charge before its receipt reaches us. Reserve both the
-- purchaser and workspace until a verified binding or explicit store cancellation.
-- Pending/unknown payments never expire merely because a local timer elapsed.
create table public.mobile_store_purchase_intents (
  id uuid primary key, user_id uuid not null references public.users(id),
  workspace_id uuid not null references public.workspaces(id),
  provider text not null check(provider in ('apple','google')), offer_key text not null,
  status text not null default 'pending' check(status in ('pending','complete','cancelled')),
  external_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index mobile_store_intent_user_pending on public.mobile_store_purchase_intents(user_id) where status='pending';
create unique index mobile_store_intent_workspace_pending on public.mobile_store_purchase_intents(workspace_id) where status='pending';
create table public.billing_events (
  id uuid primary key default gen_random_uuid(), provider text not null, event_id text not null, environment text not null,
  external_id text not null, status text not null default 'pending', attempts int not null default 0,
  payload jsonb not null, error_code text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(provider,environment,event_id)
);
create table public.mobile_notification_outbox (
  id uuid primary key default gen_random_uuid(), notification_id uuid not null references public.notifications(id),
  user_id uuid not null references public.users(id), workspace_id uuid not null references public.workspaces(id),
  category text not null, status text not null default 'pending', attempts int not null default 0,
  next_attempt_at timestamptz not null default now(), error_code text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(notification_id)
);
create index mobile_push_ready on public.mobile_notification_outbox(next_attempt_at) where status='pending';
create table public.account_deletion_requests (
  user_id uuid primary key references public.users(id), requested_at timestamptz not null default now(),
  purge_after timestamptz not null default now()+interval '30 days', status text not null default 'pending',
  closed_workspace_ids uuid[] not null default '{}', completed_at timestamptz
);
create table public.workspace_ownership_transfers (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
  from_user_id uuid not null references public.users(id), to_user_id uuid not null references public.users(id),
  status text not null default 'pending', expires_at timestamptz not null default now()+interval '7 days',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(from_user_id<>to_user_id)
);

-- This API uses a server-only service role. Public clients have no writes to these tables.
do $$ declare t text; begin
  foreach t in array array['mobile_api_operations','mobile_preferences','mobile_devices','mobile_routes','billing_contracts',
    'store_workspace_bindings','mobile_store_purchase_intents','billing_events','mobile_notification_outbox','account_deletion_requests','workspace_ownership_transfers'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

insert into public.billing_contracts(workspace_id,owner_user_id,provider,external_id,product_key,modules,interval,status,environment)
select s.workspace_id,w.owner_user_id,'stripe',s.stripe_subscription_id,'legacy',
  coalesce((select array_agg(m.module_key::text) from public.module_installations m where m.workspace_id=s.workspace_id and m.status='active'),'{}'),
  coalesce(s.billing_interval::text,'monthly'),s.status::text,'production'
from public.subscriptions s join public.workspaces w on w.id=s.workspace_id where s.stripe_subscription_id is not null
on conflict do nothing;
update public.module_installations m set billing_contract_id=c.id from public.billing_contracts c where c.workspace_id=m.workspace_id and c.current;

create function public.mobile_claim_operation(p_id uuid,p_user_id uuid,p_workspace_id uuid,p_operation text,p_fingerprint text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r mobile_api_operations%rowtype; begin
  insert into mobile_api_operations(id,user_id,workspace_id,operation,fingerprint)
    values(p_id,p_user_id,p_workspace_id,p_operation,p_fingerprint) on conflict do nothing;
  if found then return jsonb_build_object('state','claimed'); end if;
  select * into r from mobile_api_operations where id=p_id for update;
  if r.user_id<>p_user_id or r.workspace_id is distinct from p_workspace_id or r.operation<>p_operation or r.fingerprint<>p_fingerprint then
    return jsonb_build_object('state','mismatch'); end if;
  if r.status='complete' then return jsonb_build_object('state','complete','response',r.response); end if;
  return jsonb_build_object('state','pending');
end $$;

create function public.mobile_apply_receipt(p_workspace_id uuid,p_extraction_id uuid,p_actor_id uuid,p_transaction jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare r receipt_extractions%rowtype; v_customer uuid; v_id uuid; begin
  select * into r from receipt_extractions where id=p_extraction_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Receipt extraction not found.'; end if;
  if r.status='applied' and r.transaction_id is not null then return r.transaction_id; end if;
  if r.processing or r.status not in ('pending','reviewed') or r.extracted_data is null then raise exception 'Receipt is not ready for review.'; end if;
  if (p_transaction->>'amount_cents')::int<=0 or (p_transaction->>'gst_cents')::int<0 or
    (p_transaction->>'gst_cents')::int>(p_transaction->>'amount_cents')::int then raise exception 'Invalid receipt amount.'; end if;
  if p_transaction->>'type' not in ('income','expense') then raise exception 'Invalid transaction type.'; end if;
  v_customer := nullif(p_transaction->>'customer_id','')::uuid;
  if v_customer is not null and not exists(select 1 from customers where id=v_customer and workspace_id=p_workspace_id and deleted_at is null) then raise exception 'Customer not found.'; end if;
  if not exists(select 1 from files where id=r.file_id and workspace_id=p_workspace_id and upload_status='complete') then raise exception 'Receipt file not available.'; end if;
  insert into book_transactions(id,workspace_id,type,amount_cents,gst_cents,currency,date,description,category,customer_id,notes,receipt_file_id)
    values(p_extraction_id,p_workspace_id,(p_transaction->>'type')::book_type,(p_transaction->>'amount_cents')::int,
      (p_transaction->>'gst_cents')::int,p_transaction->>'currency',(p_transaction->>'date')::timestamptz,
      p_transaction->>'description',p_transaction->>'category',v_customer,p_transaction->>'notes',r.file_id) returning id into v_id;
  update receipt_extractions set status='applied',transaction_id=v_id,updated_at=now() where id=p_extraction_id;
  insert into audit_logs(workspace_id,actor_user_id,action,target_type,target_id,metadata)
    values(p_workspace_id,p_actor_id,'books.receipt.apply','receipt_extraction',p_extraction_id,jsonb_build_object('transactionId',v_id));
  insert into activity_events(workspace_id,actor_user_id,type,entity_type,entity_id,metadata)
    values(p_workspace_id,p_actor_id,'TransactionCreated','transaction',v_id,jsonb_build_object('amountCents',(p_transaction->>'amount_cents')::int,'type',p_transaction->>'type'));
  return v_id;
end $$;

create sequence public.mobile_verification_sequence;
create function public.mobile_next_verification() returns bigint language sql security definer set search_path=public as $$ select nextval('public.mobile_verification_sequence') $$;
revoke all on sequence public.mobile_verification_sequence from public,anon,authenticated;

create function public.mobile_start_store_purchase_intent(p_id uuid,p_user_id uuid,p_workspace_id uuid,p_provider text,p_offer_key text)
returns uuid language plpgsql security definer set search_path=public as $$
declare intent mobile_store_purchase_intents%rowtype; contract billing_contracts%rowtype; begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,1));
  perform 1 from workspaces where id=p_workspace_id and owner_user_id=p_user_id and deleted_at is null for update;
  if not found or not exists(select 1 from users where id=p_user_id and deleted_at is null) then raise exception 'Only the active workspace owner may purchase.'; end if;
  if p_provider not in ('apple','google') or length(p_offer_key) not between 1 and 200 then raise exception 'Invalid store offer.'; end if;
  if exists(select 1 from store_workspace_bindings where user_id=p_user_id and workspace_id<>p_workspace_id) then raise exception 'Store purchases belong to the originally selected workspace.'; end if;
  select * into intent from mobile_store_purchase_intents where id=p_id;
  if found and (intent.user_id<>p_user_id or intent.workspace_id<>p_workspace_id or intent.provider<>p_provider or intent.offer_key<>p_offer_key or intent.status<>'pending') then raise exception 'Purchase intent identifier already used.'; end if;
  select * into intent from mobile_store_purchase_intents where (user_id=p_user_id or workspace_id=p_workspace_id) and status='pending' for update;
  if found then
    if intent.user_id<>p_user_id or intent.workspace_id<>p_workspace_id or intent.provider<>p_provider or intent.offer_key<>p_offer_key then raise exception 'Another store purchase is pending. Complete or cancel it first.'; end if;
  end if;
  select * into contract from billing_contracts where workspace_id=p_workspace_id and current for update;
  if found and contract.provider in ('apple','google') and contract.status in ('billing_retry','on_hold','paused') then
    raise exception 'Fix or cancel payment with the original store before purchasing again.';
  end if;
  if found and ((contract.provider='stripe' and (contract.status in ('active','past_due') or (contract.external_id like 'checkout:%' and contract.paid_through>now()))) or (contract.provider in ('apple','google') and (contract.status in ('billing_retry','on_hold','paused') or (contract.status in ('active','grace','canceled') and greatest(contract.paid_through,contract.grace_until)>now())))) then
    if contract.provider<>p_provider or contract.owner_user_id is distinct from p_user_id then raise exception 'Existing subscription coverage must end before changing billing provider.'; end if;
  end if;
  if intent.id is not null then return intent.id; end if;
  insert into mobile_store_purchase_intents(id,user_id,workspace_id,provider,offer_key) values(p_id,p_user_id,p_workspace_id,p_provider,p_offer_key);
  return p_id;
end $$;

create function public.mobile_cancel_store_purchase_intent(p_id uuid,p_user_id uuid,p_workspace_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$ begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,1));
  perform 1 from workspaces where id=p_workspace_id and owner_user_id=p_user_id and deleted_at is null for update;
  if not found then raise exception 'Only the workspace owner may cancel a purchase intent.'; end if;
  update mobile_store_purchase_intents set status='cancelled',updated_at=now() where id=p_id and user_id=p_user_id and workspace_id=p_workspace_id and status='pending';
  return found;
end $$;

create function public.mobile_apply_store_contract(p_user_id uuid,p_workspace_id uuid,p_provider text,p_external_id text,
  p_product_key text,p_modules text[],p_interval text,p_status text,p_paid_through timestamptz,p_grace_until timestamptz,p_renews boolean,p_environment text,
  p_previous_external_id text default null,p_verification_revision bigint default 0,p_pending_modules text[] default null,p_pending_interval text default null,
  p_intent_id uuid default null,p_pending_product_key text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare old billing_contracts%rowtype; binding store_workspace_bindings%rowtype; intent mobile_store_purchase_intents%rowtype; v_id uuid; k text; v_active boolean; replacement boolean; covered boolean; begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,1));
  perform 1 from workspaces where id=p_workspace_id and deleted_at is null for update;
  if not found then raise exception 'Workspace unavailable.'; end if;
  select * into binding from store_workspace_bindings where provider=p_provider and external_id=p_external_id;
  if found and (binding.user_id<>p_user_id or binding.workspace_id<>p_workspace_id) then raise exception 'Purchase already linked to another account or workspace.'; end if;
  if not found and not exists(select 1 from workspaces where id=p_workspace_id and owner_user_id=p_user_id) then raise exception 'Only the owner may bind a purchase.'; end if;
  if exists(select 1 from store_workspace_bindings where user_id=p_user_id and workspace_id<>p_workspace_id) then raise exception 'Store purchases belong to the originally selected workspace.'; end if;
  select * into old from billing_contracts where workspace_id=p_workspace_id and current for update;
  v_active := coalesce(p_status in ('active','grace','canceled') and greatest(p_paid_through,p_grace_until)>now(),false);
  covered := coalesce((old.provider='stripe' and (old.status in ('active','past_due') or (old.external_id like 'checkout:%' and old.paid_through>now()))) or (old.provider in ('apple','google') and (old.status in ('billing_retry','on_hold','paused') or (old.status in ('active','grace','canceled') and greatest(old.paid_through,old.grace_until)>now()))),false);
  if old.verification_revision>p_verification_revision or
    (binding.id is not null and not binding.active and (old.provider<>p_provider or old.external_id<>p_external_id) and (not v_active or covered)) then
    return jsonb_build_object('id',old.id,'provider',old.provider,'status',old.status,'paidThrough',old.paid_through,'modules',old.modules,'stale',true);
  end if;
  replacement := p_provider='google' and old.provider='google' and old.external_id=p_previous_external_id and
    exists(select 1 from store_workspace_bindings where provider='google' and external_id=p_previous_external_id and user_id=p_user_id and workspace_id=p_workspace_id);
  if old.id is not null and (old.provider<>p_provider or old.external_id<>p_external_id) and not replacement and covered then
    raise exception 'Existing subscription coverage must end before changing billing provider.';
  end if;
  if p_intent_id is not null then
    select * into intent from mobile_store_purchase_intents where id=p_intent_id and user_id=p_user_id and workspace_id=p_workspace_id and provider=p_provider for update;
    if not found or intent.status='cancelled' or (intent.offer_key<>p_product_key and intent.offer_key is distinct from p_pending_product_key) or
      (intent.status='complete' and intent.external_id is distinct from p_external_id) then raise exception 'Purchase does not match its original intent.'; end if;
  else
    select * into intent from mobile_store_purchase_intents where user_id=p_user_id and workspace_id=p_workspace_id and provider=p_provider and status='pending' and
      (offer_key=p_product_key or offer_key=p_pending_product_key) for update;
  end if;
  if binding.id is null then
    if exists(select 1 from mobile_store_purchase_intents where (user_id=p_user_id or workspace_id=p_workspace_id) and status='pending' and id is distinct from intent.id) then raise exception 'Another store purchase is pending.'; end if;
    -- Google supplies the original workspace hash. Apple supplies only the user
    -- token, so its first binding additionally requires the durable workspace intent.
    if p_provider='apple' and intent.id is null then raise exception 'An original Apple purchase intent is required.'; end if;
  end if;
  -- Archive expired bindings but keep immutable historical purchase ownership.
  update store_workspace_bindings b set active=false,updated_at=now() where (b.user_id=p_user_id or b.workspace_id=p_workspace_id) and b.active and
    not exists(select 1 from billing_contracts c where c.workspace_id=b.workspace_id and c.current and c.provider=b.provider and c.external_id=b.external_id
      and c.status in ('active','grace','canceled') and greatest(c.paid_through,c.grace_until)>now());
  if exists(select 1 from store_workspace_bindings where user_id=p_user_id and workspace_id<>p_workspace_id and active) then raise exception 'A store subscription is already linked to another workspace.'; end if;
  if replacement or (old.id is not null and (old.provider<>p_provider or old.external_id<>p_external_id)) then
    update store_workspace_bindings set active=false,updated_at=now() where user_id=p_user_id and workspace_id=p_workspace_id and active;
  end if;
  update billing_contracts set current=false,updated_at=now() where workspace_id=p_workspace_id and current and (provider<>p_provider or external_id<>p_external_id);
  insert into billing_contracts(workspace_id,owner_user_id,provider,external_id,product_key,modules,interval,status,paid_through,grace_until,renews,environment,current,verification_revision,pending_modules,pending_interval)
    values(p_workspace_id,p_user_id,p_provider,p_external_id,p_product_key,p_modules,p_interval,p_status,p_paid_through,p_grace_until,p_renews,p_environment,true,p_verification_revision,p_pending_modules,p_pending_interval)
    on conflict(provider,environment,external_id) do update set product_key=excluded.product_key,modules=excluded.modules,interval=excluded.interval,
      status=excluded.status,paid_through=excluded.paid_through,grace_until=excluded.grace_until,renews=excluded.renews,verified_at=now(),updated_at=now(),current=true,verification_revision=excluded.verification_revision,pending_modules=excluded.pending_modules,pending_interval=excluded.pending_interval returning id into v_id;
  insert into store_workspace_bindings(user_id,workspace_id,provider,external_id,active) values(p_user_id,p_workspace_id,p_provider,p_external_id,v_active)
    on conflict(provider,external_id) do update set active=excluded.active,updated_at=now();
  if intent.id is not null and intent.status='pending' then
    update mobile_store_purchase_intents set status='complete',external_id=p_external_id,updated_at=now() where id=intent.id;
  end if;
  foreach k in array array['invoices','books','drive','quotes'] loop
    if v_active and k=any(p_modules) then
      insert into module_installations(workspace_id,module_key,status,billing_contract_id) values(p_workspace_id,k::module_key,'active',v_id)
        on conflict(workspace_id,module_key) do update set status='active',cancelled_at=null,
          pending_cancellation_at=case when module_installations.billing_contract_id is distinct from v_id then null else module_installations.pending_cancellation_at end,
          billing_contract_id=v_id,updated_at=now();
    else
      update module_installations set status='cancelled',cancelled_at=now(),updated_at=now() where workspace_id=p_workspace_id and module_key=k::module_key;
    end if;
  end loop;
  return jsonb_build_object('id',v_id,'provider',p_provider,'status',p_status,'paidThrough',p_paid_through,'modules',p_modules);
end $$;

create function public.mobile_accept_transfer(p_id uuid,p_user_id uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare r workspace_ownership_transfers%rowtype; begin
  -- Match account closure's user-before-workspace lock order. An in-flight
  -- acceptance cannot make a just-closed recipient the owner of an unclosed workspace.
  perform 1 from users where id=p_user_id and deleted_at is null for update;
  if not found then raise exception 'Recipient account unavailable.'; end if;
  select * into r from workspace_ownership_transfers where id=p_id and to_user_id=p_user_id for update;
  if not found or r.status<>'pending' or r.expires_at<=now() then raise exception 'Transfer unavailable or expired.'; end if;
  perform 1 from workspaces where id=r.workspace_id and owner_user_id=r.from_user_id and deleted_at is null for update;
  if not found then raise exception 'Workspace ownership has changed.'; end if;
  if not exists(select 1 from workspace_members where workspace_id=r.workspace_id and user_id=p_user_id and deleted_at is null) then raise exception 'Recipient is no longer a member.'; end if;
  update workspaces set owner_user_id=p_user_id,updated_at=now() where id=r.workspace_id;
  update workspace_members set role='admin',updated_at=now() where workspace_id=r.workspace_id and user_id=r.from_user_id and deleted_at is null;
  update workspace_members set role='owner',updated_at=now() where workspace_id=r.workspace_id and user_id=p_user_id and deleted_at is null;
  update workspace_ownership_transfers set status='accepted',updated_at=now() where id=p_id;
  insert into audit_logs(workspace_id,actor_user_id,action,target_type,target_id,metadata)
    values(r.workspace_id,p_user_id,'workspace.transfer.accept','workspace',r.workspace_id,jsonb_build_object('previousOwnerId',r.from_user_id));
  return r.workspace_id;
end $$;

create function public.mobile_close_account(p_user_id uuid,p_close_workspaces uuid[]) returns jsonb language plpgsql security definer set search_path=public as $$
declare ids uuid[]; begin
  perform 1 from users where id=p_user_id and deleted_at is null for update;
  if not found then raise exception 'Account unavailable.'; end if;
  perform 1 from workspaces where owner_user_id=p_user_id and deleted_at is null order by id for update;
  select coalesce(array_agg(id),'{}') into ids from workspaces where owner_user_id=p_user_id and deleted_at is null;
  if not ids <@ p_close_workspaces then raise exception 'Transfer or explicitly close every owned workspace before deleting this account.'; end if;
  update workspaces set deleted_at=now(),updated_at=now() where id=any(ids) and owner_user_id=p_user_id;
  update users set deleted_at=now(),updated_at=now() where id=p_user_id;
  update workspace_members set deleted_at=now(),updated_at=now() where user_id=p_user_id;
  update mobile_devices set enabled=false,updated_at=now() where user_id=p_user_id;
  update mobile_routes set points='[]',deleted_at=now(),updated_at=now() where recorder_id=p_user_id;
  insert into account_deletion_requests(user_id,closed_workspace_ids) values(p_user_id,ids) on conflict(user_id) do nothing;
  return jsonb_build_object('status','pending','purgeAfter',now()+interval '30 days');
end $$;

-- Durable push fan-out is transactionally attached to the existing in-app notification.
create function public.mobile_queue_notification() returns trigger language plpgsql security definer set search_path=public as $$
declare category text; begin
  category := case when new.type ilike '%receipt%' then 'receipts' when new.type ilike '%quote%' then 'quotes' when new.type ilike '%invoice%' or new.type ilike '%paid%' then 'payments' else 'reminders' end;
  insert into mobile_notification_outbox(notification_id,user_id,workspace_id,category) values(new.id,new.user_id,new.workspace_id,category) on conflict do nothing;
  return new;
end $$;
create trigger mobile_notification_delivery after insert on public.notifications for each row execute function public.mobile_queue_notification();

-- No SECURITY DEFINER helper is callable from a public/native client.
do $$ declare r record; begin
  for r in select p.oid::regprocedure as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'mobile_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',r.name);
    execute format('grant execute on function %s to service_role',r.name);
  end loop;
end $$;

-- Optional deterministic IDs preserve atomic line-item writes and all old RPC callers.
drop function public.create_invoice_with_lines(uuid,uuid,text,timestamptz,timestamptz,text,int,boolean,int,int,int,text,jsonb,jsonb);
create function public.create_invoice_with_lines(
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
  p_payment_methods jsonb default null,
  p_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into invoices (
    id, workspace_id, customer_id, number, status, issue_date, due_date, currency,
    tax_rate, prices_include_tax, subtotal_cents, tax_cents, total_cents, notes, payment_methods
  ) values (
    coalesce(p_id,gen_random_uuid()), p_workspace_id, p_customer_id, p_number, 'draft', p_issue_date, p_due_date, p_currency,
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


drop function public.create_quote_with_lines(uuid,uuid,text,timestamptz,timestamptz,text,int,boolean,int,int,int,text,text,jsonb,jsonb);
create function public.create_quote_with_lines(
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
  p_sections jsonb,
  p_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into quotes (
    id, workspace_id, customer_id, number, status, issue_date, valid_until, currency,
    tax_rate, prices_include_tax, subtotal_cents, tax_cents, total_cents, notes, terms_conditions
  ) values (
    coalesce(p_id,gen_random_uuid()), p_workspace_id, p_customer_id, p_number, 'draft', p_issue_date, p_valid_until, p_currency,
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


revoke all on function public.create_invoice_with_lines(uuid,uuid,text,timestamptz,timestamptz,text,int,boolean,int,int,int,text,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.create_invoice_with_lines(uuid,uuid,text,timestamptz,timestamptz,text,int,boolean,int,int,int,text,jsonb,jsonb,uuid) to service_role;

revoke all on function public.create_quote_with_lines(uuid,uuid,text,timestamptz,timestamptz,text,int,boolean,int,int,int,text,text,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.create_quote_with_lines(uuid,uuid,text,timestamptz,timestamptz,text,int,boolean,int,int,int,text,text,jsonb,jsonb,uuid) to service_role;

create function public.mobile_purge_account(p_user_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare job account_deletion_requests%rowtype; t record; remaining int; changed int; n int; round int; begin
  select * into job from account_deletion_requests where user_id=p_user_id and status='pending' and purge_after<=now() for update;
  if not found then raise exception 'Account is not due for deletion.'; end if;
  -- Closed-workspace records are removed in dependency order. Retry passes deal
  -- with non-cascading legacy FKs; any unresolved dependency rolls back the purge.
  if cardinality(job.closed_workspace_ids)>0 then
    perform 1 from workspaces where id=any(job.closed_workspace_ids) order by id for update;
    select coalesce(array_agg(id),'{}') into job.closed_workspace_ids from workspaces where id=any(job.closed_workspace_ids) and owner_user_id=p_user_id and deleted_at is not null;
    for round in 1..100 loop
      remaining:=0; changed:=0;
      for t in select c.table_name from information_schema.columns c join information_schema.tables b on b.table_schema=c.table_schema and b.table_name=c.table_name
        where c.table_schema='public' and c.column_name='workspace_id' and b.table_type='BASE TABLE' loop
        begin
          execute format('delete from public.%I where workspace_id=any($1)',t.table_name) using job.closed_workspace_ids;
          get diagnostics n = row_count; changed:=changed+n;
        exception when foreign_key_violation then remaining:=remaining+1;
        end;
      end loop;
      exit when remaining=0;
      if changed=0 then raise exception 'Closed-workspace deletion has unresolved dependencies.'; end if;
    end loop;
    delete from workspaces where id=any(job.closed_workspace_ids) and owner_user_id=p_user_id and deleted_at is not null;
  end if;
  delete from mobile_notification_outbox where user_id=p_user_id;
  delete from notifications where user_id=p_user_id;
  delete from ai_conversations where user_id=p_user_id;
  delete from mobile_routes where recorder_id=p_user_id;
  delete from mobile_devices where user_id=p_user_id;
  delete from mobile_preferences where user_id=p_user_id;
  delete from mobile_api_operations where user_id=p_user_id;
  delete from mobile_store_purchase_intents where user_id=p_user_id;
  -- Keep an opaque actor key so continuing shared financial records retain valid
  -- attribution without preserving this person's name, email or avatar.
  update users set email='deleted+'||id::text||'@invalid.local',full_name='Deleted user',avatar_url=null,updated_at=now() where id=p_user_id;
  return jsonb_build_object('purged',true);
end $$;
revoke all on function public.mobile_purge_account(uuid) from public,anon,authenticated;
grant execute on function public.mobile_purge_account(uuid) to service_role;

create function public.mobile_apply_stripe_contract(p_workspace_id uuid,p_external_id text,p_modules text[],p_interval text,
  p_status text,p_paid_through timestamptz,p_renews boolean,p_checkout boolean default false,p_reservation_id text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare old billing_contracts%rowtype; local subscriptions%rowtype; v_id uuid; k text; begin
  perform 1 from workspaces where id=p_workspace_id and deleted_at is null for update;
  if not found then return false; end if;
  select * into old from billing_contracts where workspace_id=p_workspace_id and current for update;
  if found and old.provider<>'stripe' and (old.status in ('billing_retry','on_hold','paused') or (greatest(old.paid_through,old.grace_until)>now() and old.status in ('active','grace','canceled'))) then return false; end if;
  if not p_checkout and old.provider is not null and old.provider<>'stripe' then return false; end if;
  select * into local from subscriptions where workspace_id=p_workspace_id;
  if not p_checkout and local.stripe_subscription_id is distinct from p_external_id then return false; end if;
  if p_checkout and old.external_id like 'checkout:%' and old.paid_through>now() and old.external_id is distinct from 'checkout:'||coalesce(p_reservation_id,'') then return false; end if;
  if p_checkout and local.stripe_subscription_id is not null and local.stripe_subscription_id<>p_external_id and local.status in ('active','past_due') then return false; end if;
  update billing_contracts set current=false,updated_at=now() where workspace_id=p_workspace_id and current and (provider<>'stripe' or external_id<>p_external_id);
  insert into billing_contracts(workspace_id,owner_user_id,provider,external_id,product_key,modules,interval,status,paid_through,renews,environment,current)
    select p_workspace_id,w.owner_user_id,'stripe',p_external_id,'web',p_modules,p_interval,p_status,p_paid_through,p_renews,'production',true from workspaces w where w.id=p_workspace_id
    on conflict(provider,environment,external_id) do update set modules=excluded.modules,interval=excluded.interval,status=excluded.status,
      paid_through=excluded.paid_through,renews=excluded.renews,current=true,verified_at=now(),updated_at=now() returning id into v_id;
  foreach k in array array['invoices','books','drive','quotes'] loop
    if p_status in ('active','past_due') and k=any(p_modules) then
      insert into module_installations(workspace_id,module_key,status,billing_contract_id) values(p_workspace_id,k::module_key,'active',v_id)
        on conflict(workspace_id,module_key) do update set status='active',cancelled_at=null,
          pending_cancellation_at=case when module_installations.billing_contract_id is distinct from v_id then null else module_installations.pending_cancellation_at end,
          billing_contract_id=v_id,updated_at=now();
    else
      update module_installations set status='cancelled',cancelled_at=now(),updated_at=now() where workspace_id=p_workspace_id and module_key=k::module_key and (billing_contract_id is null or billing_contract_id=v_id);
    end if;
  end loop;
  return true;
end $$;
revoke all on function public.mobile_apply_stripe_contract(uuid,text,text[],text,text,timestamptz,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.mobile_apply_stripe_contract(uuid,text,text[],text,text,timestamptz,boolean,boolean,text) to service_role;

create function public.mobile_reserve_stripe_checkout(p_workspace_id uuid,p_reservation_id uuid,p_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$
declare r billing_contracts%rowtype; begin
  perform 1 from workspaces where id=p_workspace_id and deleted_at is null for update;
  if not found then return false; end if;
  if exists(select 1 from mobile_store_purchase_intents where workspace_id=p_workspace_id and status='pending') then return false; end if;
  select * into r from billing_contracts where workspace_id=p_workspace_id and current for update;
  if found then
    if r.external_id='checkout:'||p_reservation_id::text then return true; end if;
    if ((r.provider='stripe' and (r.status in ('active','past_due') or (r.external_id like 'checkout:%' and r.paid_through>now()))) or (r.provider in ('apple','google') and (r.status in ('billing_retry','on_hold','paused') or (r.status in ('active','grace','canceled') and greatest(r.paid_through,r.grace_until)>now())))) then return false; end if;
  end if;
  if p_expires_at<=now() or p_expires_at>now()+interval '2 hours' then raise exception 'Invalid checkout reservation expiry.'; end if;
  update billing_contracts set current=false,updated_at=now() where workspace_id=p_workspace_id and current;
  insert into billing_contracts(workspace_id,owner_user_id,provider,external_id,product_key,interval,status,paid_through,renews,environment)
    select p_workspace_id,owner_user_id,'stripe','checkout:'||p_reservation_id::text,'checkout','monthly','incomplete',p_expires_at,false,'production' from workspaces where id=p_workspace_id;
  return true;
end $$;
create function public.mobile_release_stripe_checkout(p_workspace_id uuid,p_reservation_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$ begin
  perform 1 from workspaces where id=p_workspace_id for update;
  update billing_contracts set current=false,status='canceled',updated_at=now() where workspace_id=p_workspace_id and current and external_id='checkout:'||p_reservation_id::text and status='incomplete';
  return found;
end $$;
revoke all on function public.mobile_reserve_stripe_checkout(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.mobile_reserve_stripe_checkout(uuid,uuid,timestamptz) to service_role;
revoke all on function public.mobile_release_stripe_checkout(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mobile_release_stripe_checkout(uuid,uuid) to service_role;

create function public.mobile_change_stripe_module(p_workspace_id uuid,p_external_id text,p_module_key text,p_enabled boolean,p_item_id text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare r billing_contracts%rowtype; s subscriptions%rowtype; begin
  perform 1 from workspaces where id=p_workspace_id and deleted_at is null for update;
  if not found then return false; end if;
  select * into r from billing_contracts where workspace_id=p_workspace_id and current for update;
  select * into s from subscriptions where workspace_id=p_workspace_id;
  if s.stripe_subscription_id is distinct from p_external_id or (r.provider is not null and r.provider<>'stripe') then return false; end if;
  if r.id is null then
    insert into billing_contracts(workspace_id,owner_user_id,provider,external_id,product_key,modules,interval,status,environment)
      select p_workspace_id,w.owner_user_id,'stripe',p_external_id,'legacy',
        coalesce((select array_agg(module_key::text) from module_installations where workspace_id=p_workspace_id and status='active'),'{}'),
        coalesce(s.billing_interval::text,'monthly'),s.status::text,'production' from workspaces w where w.id=p_workspace_id returning * into r;
  end if;
  if r.external_id<>p_external_id or p_module_key not in ('invoices','books','drive','quotes') then return false; end if;
  if p_enabled and (s.status not in ('active','past_due') or r.status not in ('active','past_due')) then return false; end if;
  if p_enabled then
    update billing_contracts set modules=array(select distinct unnest(array_append(modules,p_module_key))),updated_at=now() where id=r.id;
    insert into module_installations(workspace_id,module_key,status,stripe_subscription_item_id,billing_contract_id)
      values(p_workspace_id,p_module_key::module_key,'active',p_item_id,r.id)
      on conflict(workspace_id,module_key) do update set status='active',stripe_subscription_item_id=excluded.stripe_subscription_item_id,
        billing_contract_id=r.id,cancelled_at=null,pending_cancellation_at=null,updated_at=now();
  else
    update billing_contracts set modules=array_remove(modules,p_module_key),updated_at=now() where id=r.id;
    update module_installations set status='cancelled',cancelled_at=now(),pending_cancellation_at=null,updated_at=now()
      where workspace_id=p_workspace_id and module_key=p_module_key::module_key and (billing_contract_id is null or billing_contract_id=r.id);
  end if;
  return true;
end $$;
revoke all on function public.mobile_change_stripe_module(uuid,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.mobile_change_stripe_module(uuid,text,text,boolean,text) to service_role;

-- Native expected timestamps are checked in the same row lock as the actual
-- update. All writers advance by at least a millisecond, matching JSON Date precision.
create function public.mobile_guard_record_version() returns trigger language plpgsql set search_path=public as $$ begin
  if new.mobile_expected_updated_at is not null and date_trunc('milliseconds',old.updated_at) is distinct from date_trunc('milliseconds',new.mobile_expected_updated_at at time zone 'UTC') then
    raise exception 'This record changed. Refresh before saving.' using errcode='40001';
  end if;
  new.mobile_expected_updated_at:=null;
  new.updated_at:=greatest(date_trunc('milliseconds',clock_timestamp() at time zone 'UTC'),date_trunc('milliseconds',old.updated_at)+interval '1 millisecond');
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['customers','invoices','quotes','book_transactions','drive_earnings','drive_trips','vehicles','driver_vehicle_expenses'] loop
    execute format('alter table public.%I add column mobile_expected_updated_at timestamptz',t);
    execute format('create trigger mobile_record_version before update on public.%I for each row execute function public.mobile_guard_record_version()',t);
  end loop;
end $$;

create or replace function public.update_invoice_with_lines(
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
    mobile_expected_updated_at = r.mobile_expected_updated_at,
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

create or replace function public.update_quote_with_lines(
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
    mobile_expected_updated_at = r.mobile_expected_updated_at,
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
