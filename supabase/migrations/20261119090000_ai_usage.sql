-- hAI Wave 4: a ledger of what each model call used. Additive only.
--
-- ai_usage_events has one row per model call: a chat turn with all of its tool steps, a
-- generated conversation title, a receipt read. ai_usage_monthly keeps running totals per
-- workspace, calendar month and feature, so the settings page (and a later allowance
-- check) reads a handful of small rows instead of summing events.
--
-- Tokens and the model only. There is no price table, so no money is stored here, and
-- this ledger is separate from the credit ledger. `input_tokens` counts every input
-- token of the call, including the ones read from or written to the provider's prompt
-- cache; `cache_read_tokens` and `cache_write_tokens` say how many of them those were.
create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Usage outlives the person and the conversation it came from.
  user_id uuid references public.users(id) on delete set null,
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  -- What the call was for: 'chat', 'title', 'receipt'. Text, so a new feature needs no
  -- migration; the check keeps it a short machine name.
  feature text not null,
  -- Where the request came from ('web', 'mobile'); null when the caller does not know.
  surface text,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  -- Model requests inside the call: a chat turn makes one per tool-calling step.
  step_count integer not null default 1,
  created_at timestamptz not null default now(),
  constraint ai_usage_events_feature_check check (feature ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint ai_usage_events_counts_check check (
    input_tokens >= 0
    and output_tokens >= 0
    and cache_read_tokens >= 0
    and cache_write_tokens >= 0
    and step_count >= 0
  )
);

create index ai_usage_events_workspace_created_idx
  on public.ai_usage_events (workspace_id, created_at desc);

-- Deleting a conversation clears this column on its events; the index keeps that a probe.
create index ai_usage_events_conversation_idx
  on public.ai_usage_events (conversation_id)
  where conversation_id is not null;

-- `month` is the first day of the calendar month in UTC. The primary key serves the only
-- read there is: one workspace's rows for a few months.
create table public.ai_usage_monthly (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  month date not null,
  feature text not null,
  call_count bigint not null default 0,
  step_count bigint not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, month, feature),
  constraint ai_usage_monthly_month_check check (month = date_trunc('month', month)::date)
);

-- Record one model call and add it to its month's totals. One function, so the event and
-- the rollup commit together (PostgREST has no multi-statement transactions) and two
-- calls recorded at the same moment both land in the totals. Counts that are missing or
-- negative are stored as zero. A conversation that has since been deleted, or that
-- belongs to another workspace, is recorded as no conversation instead of failing the
-- write. `p_created_at` is for recording a call after the fact; it defaults to now.
create or replace function public.record_ai_usage(
  p_workspace_id uuid,
  p_feature text,
  p_provider text,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cache_read_tokens integer default 0,
  p_cache_write_tokens integer default 0,
  p_step_count integer default 1,
  p_user_id uuid default null,
  p_conversation_id uuid default null,
  p_surface text default null,
  p_created_at timestamptz default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_created_at timestamptz := coalesce(p_created_at, now());
  v_input integer := greatest(coalesce(p_input_tokens, 0), 0);
  v_output integer := greatest(coalesce(p_output_tokens, 0), 0);
  v_cache_read integer := greatest(coalesce(p_cache_read_tokens, 0), 0);
  v_cache_write integer := greatest(coalesce(p_cache_write_tokens, 0), 0);
  v_steps integer := greatest(coalesce(p_step_count, 1), 0);
  v_conversation_id uuid;
  v_event_id uuid;
begin
  if p_conversation_id is not null then
    select conversation.id
      into v_conversation_id
      from public.ai_conversations as conversation
     where conversation.id = p_conversation_id
       and conversation.workspace_id = p_workspace_id
       -- Held until this function commits, so the conversation cannot be deleted
       -- between this check and the insert below.
       for key share;
  end if;

  insert into public.ai_usage_events (
    workspace_id, user_id, conversation_id, feature, surface, provider, model,
    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, step_count, created_at
  )
  values (
    p_workspace_id, p_user_id, v_conversation_id, p_feature, p_surface, p_provider, p_model,
    v_input, v_output, v_cache_read, v_cache_write, v_steps, v_created_at
  )
  returning id into v_event_id;

  insert into public.ai_usage_monthly as monthly (
    workspace_id, month, feature, call_count, step_count,
    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, updated_at
  )
  values (
    p_workspace_id,
    date_trunc('month', v_created_at at time zone 'UTC')::date,
    p_feature,
    1, v_steps, v_input, v_output, v_cache_read, v_cache_write, now()
  )
  on conflict (workspace_id, month, feature) do update
    set call_count = monthly.call_count + 1,
        step_count = monthly.step_count + excluded.step_count,
        input_tokens = monthly.input_tokens + excluded.input_tokens,
        output_tokens = monthly.output_tokens + excluded.output_tokens,
        cache_read_tokens = monthly.cache_read_tokens + excluded.cache_read_tokens,
        cache_write_tokens = monthly.cache_write_tokens + excluded.cache_write_tokens,
        updated_at = excluded.updated_at;

  return v_event_id;
end;
$$;

revoke all on function public.record_ai_usage(
  uuid, text, text, text, integer, integer, integer, integer, integer, uuid, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_ai_usage(
  uuid, text, text, text, integer, integer, integer, integer, integer, uuid, uuid, text, timestamptz
) to service_role;

-- Owner/admin helper for the read policies below, in the style of is_workspace_member
-- (SECURITY DEFINER, so the policy does not depend on the caller's own access to
-- workspace_members). Usage is workspace management information, like billing.
create or replace function public.is_workspace_admin(p_workspace_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members as wm
    join public.workspaces as w on w.id = wm.workspace_id
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_user_id
      and wm.role in ('owner', 'admin')
      and wm.deleted_at is null
      and w.deleted_at is null
  );
$$;

revoke all on function public.is_workspace_admin(uuid, uuid) from public, anon;
grant execute on function public.is_workspace_admin(uuid, uuid) to authenticated, service_role;

-- Only the service role writes (through record_ai_usage). A signed-in owner or admin may
-- read their own workspace's rows; nobody else sees any.
alter table public.ai_usage_events enable row level security;
alter table public.ai_usage_monthly enable row level security;
revoke all on public.ai_usage_events from anon, authenticated;
revoke all on public.ai_usage_monthly from anon, authenticated;
grant all on public.ai_usage_events to service_role;
grant all on public.ai_usage_monthly to service_role;
grant select on public.ai_usage_events to authenticated;
grant select on public.ai_usage_monthly to authenticated;

create policy ai_usage_events_select on public.ai_usage_events
  for select to authenticated
  using (public.is_workspace_admin(workspace_id, (select auth.uid())));

create policy ai_usage_monthly_select on public.ai_usage_monthly
  for select to authenticated
  using (public.is_workspace_admin(workspace_id, (select auth.uid())));
