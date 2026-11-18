-- Exact totals computed in Postgres.
--
-- PostgREST caps every response at `max_rows` (1,000 locally and by default when hosted).
-- The GST/BAS page, tax lodging and the credit balance used to fetch raw rows and add them
-- up in application code, so their totals were silently wrong once a workspace passed
-- 1,000 transactions or ledger entries. These functions return the aggregate only.

-- GST collected / paid per calendar month for a whole workspace. At most twelve rows a
-- year, so the row cap is not a concern. The caller buckets months into financial-year
-- quarters (quarters are month-aligned for every `fy_start_month`). `date` is a
-- `timestamp without time zone`, read as UTC by the application, so `to_char` on the raw
-- value matches the application's `getUTCMonth()` bucketing. Mirrors `summarizeGst`:
-- magnitudes are absolute and every non-income row counts as GST paid.
create or replace function public.get_gst_monthly(p_workspace_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with months as (
    select
      to_char(date, 'YYYY-MM') as month,
      coalesce(sum(abs(gst_cents)) filter (where type = 'income'), 0)::bigint
        as gst_collected_cents,
      coalesce(sum(abs(gst_cents)) filter (where type <> 'income'), 0)::bigint
        as gst_paid_cents
    from public.book_transactions
    where workspace_id = p_workspace_id
    group by to_char(date, 'YYYY-MM')
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'month', month,
        'gstCollectedCents', gst_collected_cents,
        'gstPaidCents', gst_paid_cents
      )
      order by month
    ),
    '[]'::jsonb
  )
  from months;
$$;

-- Credit balance for one workspace and currency: the signed sum of the append-only ledger.
-- `consume_credit` keeps its own locked sum for the atomic overdraft check; this is the
-- read-side equivalent.
create or replace function public.get_credit_balance(
  p_workspace_id uuid,
  p_currency text default 'AUD'
)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(amount_cents), 0)::bigint
  from public.credit_ledger
  where workspace_id = p_workspace_id
    and currency = p_currency;
$$;

revoke all on function public.get_gst_monthly(uuid) from public, anon, authenticated;
revoke all on function public.get_credit_balance(uuid, text) from public, anon, authenticated;

grant execute on function public.get_gst_monthly(uuid) to service_role;
grant execute on function public.get_credit_balance(uuid, text) to service_role;
