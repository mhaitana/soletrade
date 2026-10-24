-- One durable recipient per notification/device. Accepted tickets are never sent again;
-- receipt polling is independent of the parent job's fan-out completion.
create table public.mobile_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.mobile_notification_outbox(id) on delete cascade,
  user_id uuid not null,
  device_id text not null,
  token text not null,
  registration_updated_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','deferred','sending','accepted','delivered','failed','uncertain','skipped')),
  attempts integer not null default 0 check (attempts between 0 and 8),
  next_attempt_at timestamptz not null default now(),
  ticket_id text unique check (ticket_id is null or length(ticket_id) between 1 and 200),
  accepted_at timestamptz,
  receipt_status text check (receipt_status in ('pending','polling','ok','error','unknown')),
  receipt_attempts integer not null default 0 check (receipt_attempts between 0 and 64),
  receipt_poll_after timestamptz,
  error_code text check (error_code is null or length(error_code)<=100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(outbox_id,device_id),
  foreign key (user_id,device_id) references public.mobile_devices(user_id,id) on delete cascade,
  check (ticket_id is null or accepted_at is not null)
);
create index mobile_push_delivery_ready on public.mobile_push_deliveries(outbox_id,next_attempt_at) where status in ('pending','deferred');
create index mobile_push_receipt_ready on public.mobile_push_deliveries(receipt_poll_after) where status='accepted' and receipt_status='pending';
create index mobile_push_delivery_recovery on public.mobile_push_deliveries(updated_at) where status='sending' or receipt_status='polling';

alter table public.mobile_push_deliveries enable row level security;
revoke all on public.mobile_push_deliveries from public,anon,authenticated;
grant select,insert,update,delete on public.mobile_push_deliveries to service_role;

-- The outbox is deleted before device registrations during account purge. Cascading
-- this FK also clears token snapshots and receipts for closed workspaces and users.

-- Serialize registration changes so a token can move accounts without a unique-key
-- race. Refreshing the same user's device preserves its accepted notification ledger.
create function public.mobile_register_device(p_user_id uuid,p_device_id text,p_token text,p_platform text,p_timezone text)
returns boolean language plpgsql security definer set search_path=public as $$
declare previous mobile_devices%rowtype; stamp timestamptz; begin
  if not exists(select 1 from users where id=p_user_id and deleted_at is null) then raise exception 'Account unavailable.'; end if;
  if length(p_device_id) not between 1 and 200 or btrim(p_device_id)='' or length(p_token)>250 or p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' then raise exception 'Invalid device registration.'; end if;
  if p_platform not in ('ios','android') or not exists(select 1 from pg_timezone_names where lower(name)=lower(p_timezone)) then raise exception 'Invalid device registration.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mobile-device-registration',0));
  delete from mobile_devices where token=p_token and (user_id<>p_user_id or id<>p_device_id);
  select * into previous from mobile_devices where user_id=p_user_id and id=p_device_id for update;
  stamp:=greatest(date_trunc('milliseconds',clock_timestamp()),coalesce(previous.updated_at,'epoch'::timestamptz)+interval '1 millisecond');
  insert into mobile_devices(user_id,id,token,platform,timezone,enabled,updated_at)
    values(p_user_id,p_device_id,p_token,p_platform,p_timezone,true,stamp)
    on conflict(user_id,id) do update set token=excluded.token,platform=excluded.platform,timezone=excluded.timezone,enabled=true,updated_at=excluded.updated_at;
  return true;
end $$;
revoke all on function public.mobile_register_device(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.mobile_register_device(uuid,text,text,text,text) to service_role;

alter table public.mobile_push_deliveries add constraint mobile_push_accepted_has_ticket check(status not in ('accepted','delivered') or (ticket_id is not null and accepted_at is not null));
alter table public.mobile_push_deliveries add constraint mobile_push_receipt_has_ticket check(receipt_status is null or ticket_id is not null);
