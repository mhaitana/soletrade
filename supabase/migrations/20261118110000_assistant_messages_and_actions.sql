-- hAI Wave 3: whole assistant messages, and a ledger of the changes hAI proposes.
--
-- One ai_messages row is one chat message as the chat shows it. `parts` holds the
-- message's parts as the AI SDK produces them: text, tool calls with their results and
-- approval state, and action previews. `content` keeps the plain text for older app
-- builds and titles. Rows saved before this migration have content only.
alter table public.ai_messages
  add column parts jsonb,
  add column metadata jsonb;

-- Every change hAI proposes is recorded before anyone approves it. The row moves
-- pending -> approved | denied when the user decides, then approved -> running ->
-- succeeded | failed when the change runs. Each step is a conditional update on the
-- current status, so a repeated or concurrent approval cannot run a change twice.
-- The tool name and input are the server's copy from the model's call; the client only
-- ever sends an approval id and a yes or no.
create type public.ai_tool_action_status as enum (
  'pending', 'approved', 'denied', 'running', 'succeeded', 'failed'
);

create table public.ai_tool_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  tool_call_id text not null,
  tool_name text not null,
  input jsonb not null,
  preview jsonb,
  status public.ai_tool_action_status not null default 'pending',
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  completed_at timestamptz,
  constraint ai_tool_actions_call_unique unique (conversation_id, tool_call_id)
);

create index ai_tool_actions_workspace_created_idx
  on public.ai_tool_actions (workspace_id, created_at desc);

-- Same visibility as the conversation it belongs to: the member who owns it. The app reads
-- and writes through the service role.
alter table public.ai_tool_actions enable row level security;
revoke all on public.ai_tool_actions from anon, authenticated;
grant all on public.ai_tool_actions to service_role;
grant select on public.ai_tool_actions to authenticated;
create policy ai_tool_actions_select on public.ai_tool_actions
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id, (select auth.uid()))
    and user_id = (select auth.uid())
  );
