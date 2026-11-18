-- hAI Wave 5: briefing facts and the opt-in briefing digest. Additive only.

-- Counts and totals behind the dashboard briefing and the digest, for one workspace on one
-- local day. Every number a briefing shows is computed here or by an existing count; none
-- comes from a model. The caller decides which sections a member may see (installed
-- modules and role) and passes the workspace's local date as `p_today`, so "today" follows
-- the workspace timezone rather than the database clock.
--
-- Overdue, draft and accepted use the same definitions as the dashboard summary functions
-- (the status each record carries), so a briefing and the lists it links to agree.
-- "Due soon" and "expiring soon" are documents still awaiting the customer whose date falls
-- on `p_today` or within the following `p_days` days. `due_date` and `valid_until` are
-- timestamps without time zone holding a calendar date at midnight, so they compare
-- directly against a date.
create or replace function public.get_insight_facts(
  p_workspace_id uuid,
  p_today date,
  p_include_invoices boolean default true,
  p_include_quotes boolean default true,
  p_days integer default 7
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with invoice_facts as (
    select
      count(*) filter (where status = 'overdue')::bigint as overdue_count,
      coalesce(sum(total_cents::bigint) filter (where status = 'overdue'), 0)::bigint
        as overdue_cents,
      count(*) filter (where status = 'draft')::bigint as draft_count,
      count(*) filter (
        where status in ('sent', 'viewed')
          and due_date >= p_today
          and due_date < p_today + (p_days + 1)
      )::bigint as due_soon_count,
      coalesce(sum(total_cents::bigint) filter (
        where status in ('sent', 'viewed')
          and due_date >= p_today
          and due_date < p_today + (p_days + 1)
      ), 0)::bigint as due_soon_cents
    from public.invoices
    where p_include_invoices
      and workspace_id = p_workspace_id
      and status in ('overdue', 'draft', 'sent', 'viewed')
  ),
  quote_facts as (
    select
      count(*) filter (where status = 'accepted')::bigint as accepted_count,
      coalesce(sum(total_cents::bigint) filter (where status = 'accepted'), 0)::bigint
        as accepted_cents,
      count(*) filter (
        where status in ('sent', 'viewed')
          and valid_until >= p_today
          and valid_until < p_today + (p_days + 1)
      )::bigint as expiring_count,
      coalesce(sum(total_cents::bigint) filter (
        where status in ('sent', 'viewed')
          and valid_until >= p_today
          and valid_until < p_today + (p_days + 1)
      ), 0)::bigint as expiring_cents
    from public.quotes
    where p_include_quotes
      and workspace_id = p_workspace_id
      and status in ('accepted', 'sent', 'viewed')
  )
  select jsonb_build_object(
    'invoices', case when p_include_invoices then jsonb_build_object(
      'overdueCount', invoice_facts.overdue_count,
      'overdueCents', invoice_facts.overdue_cents,
      'dueSoonCount', invoice_facts.due_soon_count,
      'dueSoonCents', invoice_facts.due_soon_cents,
      'draftCount', invoice_facts.draft_count
    ) end,
    'quotes', case when p_include_quotes then jsonb_build_object(
      'acceptedCount', quote_facts.accepted_count,
      'acceptedCents', quote_facts.accepted_cents,
      'expiringCount', quote_facts.expiring_count,
      'expiringCents', quote_facts.expiring_cents
    ) end
  )
  from invoice_facts cross join quote_facts;
$$;

revoke all on function public.get_insight_facts(uuid, date, boolean, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.get_insight_facts(uuid, date, boolean, boolean, integer)
  to service_role;

-- Briefing digest: each member chooses, per workspace, whether to receive it. No row means
-- off, and nobody is ever opted in by default.
create type public.ai_digest_frequency as enum ('off', 'daily', 'weekly');

-- `last_period` is the workspace-local date of the last period this member was picked for:
-- the day for a daily digest, that week's Monday for a weekly one. It is the only thing that
-- stops a second send, and only the claim below moves it forward.
create table public.ai_digest_preferences (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  frequency public.ai_digest_frequency not null default 'off',
  last_period date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- The hourly job reads opted-in rows only, least recently served first.
create index ai_digest_preferences_due_idx
  on public.ai_digest_preferences (last_period)
  where frequency <> 'off';

-- A member can read only their own choice in a workspace they belong to. As with every
-- other table, a signed-in session cannot write here directly: the app saves the choice,
-- and the job moves `last_period`, through the service role, after checking who is asking.
-- So nobody can ask for a second send by rewinding `last_period`.
alter table public.ai_digest_preferences enable row level security;
revoke all on public.ai_digest_preferences from anon, authenticated;
grant all on public.ai_digest_preferences to service_role;
grant select on public.ai_digest_preferences to authenticated;
create policy ai_digest_preferences_select on public.ai_digest_preferences
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id, (select auth.uid()))
    and user_id = (select auth.uid())
  );

-- Wall-clock time in a workspace's timezone. The timezone is free text on the workspace, so
-- a name PostgreSQL does not know falls back to UTC instead of failing the whole run.
create or replace function public.ai_digest_local_time(p_now timestamptz, p_timezone text)
returns timestamp
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  return p_now at time zone coalesce(p_timezone, 'UTC');
exception
  when invalid_parameter_value then
    return p_now at time zone 'UTC';
end;
$$;

-- Pick the members who are owed a digest and mark them served, in one statement. A member
-- is due when they opted in, are still an active member of a live workspace, it is 07:00 or
-- later in the workspace's timezone (and a Monday there, for weekly), and `last_period` is
-- before the workspace's local date. Rows locked by an overlapping run are skipped, and the
-- update repeats the `last_period` check, so two runs can never both return the same member
-- for the same period. Returns at most `p_limit` members; the rest stay due for the next
-- call. The caller sends after the claim, so a crash loses a digest rather than repeating it.
create or replace function public.claim_ai_digests(
  p_now timestamptz,
  p_limit integer default 50
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  with due as (
    select
      pref.workspace_id,
      pref.user_id,
      pref.frequency,
      pref.last_period as previous_period,
      clock.local_time::date as period,
      member.role,
      account.email
    from public.ai_digest_preferences as pref
    join public.workspaces as workspace
      on workspace.id = pref.workspace_id and workspace.deleted_at is null
    join public.workspace_members as member
      on member.workspace_id = pref.workspace_id
      and member.user_id = pref.user_id
      and member.deleted_at is null
    join public.users as account
      on account.id = pref.user_id and account.deleted_at is null
    cross join lateral (
      select public.ai_digest_local_time(p_now, workspace.timezone) as local_time
    ) as clock
    where pref.frequency <> 'off'
      and extract(hour from clock.local_time) >= 7
      and (pref.frequency = 'daily' or extract(isodow from clock.local_time) = 1)
      and (pref.last_period is null or pref.last_period < clock.local_time::date)
    order by pref.last_period nulls first, pref.workspace_id, pref.user_id
    limit greatest(1, least(coalesce(p_limit, 50), 500))
    for update of pref skip locked
  ),
  claimed as (
    update public.ai_digest_preferences as pref
    set last_period = due.period
    from due
    where pref.workspace_id = due.workspace_id
      and pref.user_id = due.user_id
      and (pref.last_period is null or pref.last_period < due.period)
    returning
      due.workspace_id,
      due.user_id,
      due.frequency,
      due.period,
      due.previous_period,
      due.role,
      due.email
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'workspaceId', claimed.workspace_id,
        'userId', claimed.user_id,
        'frequency', claimed.frequency,
        'period', claimed.period,
        'previousPeriod', claimed.previous_period,
        'role', claimed.role,
        'email', claimed.email
      )
      order by claimed.workspace_id, claimed.user_id
    ),
    '[]'::jsonb
  )
  from claimed;
$$;

revoke all on function public.ai_digest_local_time(timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.claim_ai_digests(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.ai_digest_local_time(timestamptz, text) to service_role;
grant execute on function public.claim_ai_digests(timestamptz, integer) to service_role;
