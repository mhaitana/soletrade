-- Thumbs up or down on a reply from hAI, with an optional note on what was wrong.
--
-- One row per member per reply. The reply's text is copied in when it is rated, because
-- "Answer again" deletes the reply it replaces: a thumbs-down followed by a retry is the
-- feedback most worth keeping, so the row outlives the message (message_id becomes null)
-- and goes only when the conversation itself is deleted.
create table public.ai_message_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  message_id uuid references public.ai_messages(id) on delete set null,
  rating text not null,
  comment text,
  message_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_message_feedback_rating_check check (rating in ('up', 'down')),
  constraint ai_message_feedback_comment_length check (
    comment is null or char_length(comment) <= 1000
  ),
  constraint ai_message_feedback_one_per_member unique (message_id, user_id)
);

create index ai_message_feedback_workspace_created_idx
  on public.ai_message_feedback (workspace_id, created_at desc);
create index ai_message_feedback_conversation_idx
  on public.ai_message_feedback (conversation_id);

-- Same visibility as the conversation it belongs to: the member who owns it. The app reads
-- and writes through the service role.
alter table public.ai_message_feedback enable row level security;
revoke all on public.ai_message_feedback from anon, authenticated;
grant all on public.ai_message_feedback to service_role;
grant select on public.ai_message_feedback to authenticated;
create policy ai_message_feedback_select on public.ai_message_feedback
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id, (select auth.uid()))
    and user_id = (select auth.uid())
  );
