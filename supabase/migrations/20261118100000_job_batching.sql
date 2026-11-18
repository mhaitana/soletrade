-- Scheduled-job helpers. Additive only.

-- Credit expiry: grants and promotions past their expiry that have not been reversed yet.
-- The nightly job used to read every grant that had ever expired, including ones reversed
-- long ago, then run one more query per grant to look for its reversal. This returns only
-- the work left to do, oldest first, as full ledger rows. The anti-join is answered by the
-- `credit_ledger_expired_original_unique` index; `expires_at` is a timestamp without time
-- zone that the application compares as UTC, so `p_now` takes the same type.
create or replace function public.list_due_credit_expiries(
  p_now timestamp,
  p_limit integer default 200
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(due) order by due.expires_at, due.id), '[]'::jsonb)
  from (
    select grant_row.*
    from public.credit_ledger as grant_row
    where grant_row.entry_type in ('grant', 'promotion')
      and grant_row.expires_at is not null
      and grant_row.expires_at <= p_now
      and not exists (
        select 1
        from public.credit_ledger as reversal
        where reversal.entry_type = 'expired'
          and reversal.workspace_id = grant_row.workspace_id
          and reversal.metadata ->> 'originalEntryId' = grant_row.id::text
      )
    order by grant_row.expires_at, grant_row.id
    limit greatest(1, least(coalesce(p_limit, 200), 1000))
  ) as due;
$$;

revoke all on function public.list_due_credit_expiries(timestamp, integer)
  from public, anon, authenticated;
grant execute on function public.list_due_credit_expiries(timestamp, integer) to service_role;

-- Mobile idempotency records. Each mobile write keeps a row so a retried request returns
-- the first result instead of acting twice; nothing ever removed them. Completed rows past
-- the retention window are deleted in bounded batches by the per-minute mobile cron, so
-- the index keeps each run to a short range probe. Rows still processing are never pruned:
-- the job-health check reports them.
create index if not exists mobile_operations_complete_created_idx
  on public.mobile_api_operations (created_at)
  where status = 'complete';

create or replace function public.prune_mobile_operations(
  p_before timestamptz,
  p_limit integer default 1000
)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  with doomed as (
    select id
    from public.mobile_api_operations
    where status = 'complete'
      and created_at < p_before
    order by created_at
    limit greatest(1, least(coalesce(p_limit, 1000), 5000))
  ),
  deleted as (
    delete from public.mobile_api_operations as operation
    using doomed
    where operation.id = doomed.id
    returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke all on function public.prune_mobile_operations(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.prune_mobile_operations(timestamptz, integer) to service_role;
