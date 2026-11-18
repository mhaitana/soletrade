-- Indexes for scheduled jobs and the assistant conversation list. Additive only.

-- The overdue-invoice and expired-quote crons update across every workspace by status and
-- date; every existing index on these tables leads with workspace_id.
create index if not exists invoices_open_due_idx
  on public.invoices (due_date)
  where status in ('sent', 'viewed') and due_date is not null;

create index if not exists quotes_open_valid_until_idx
  on public.quotes (valid_until)
  where status in ('sent', 'viewed') and valid_until is not null;

-- Credit-expiry cron: grants and promotions whose expiry has passed.
create index if not exists credit_ledger_expiring_idx
  on public.credit_ledger (expires_at)
  where entry_type in ('grant', 'promotion') and expires_at is not null;

-- The conversation list orders by updated_at; the existing index orders by created_at.
create index if not exists ai_conversations_workspace_user_updated_idx
  on public.ai_conversations (workspace_id, user_id, updated_at desc, id desc);

-- Mobile job-health counts run every minute and had no supporting index.
create index if not exists mobile_operations_processing_idx
  on public.mobile_api_operations (updated_at)
  where status = 'processing';

create index if not exists mobile_push_delivery_attention_idx
  on public.mobile_push_deliveries (status)
  where status in ('failed', 'uncertain');

create index if not exists mobile_notification_outbox_attention_idx
  on public.mobile_notification_outbox (status)
  where status in ('failed', 'uncertain');
