-- Read-path performance improvements for authenticated page loads, dashboards, and filters.
--
-- 1. Match the composite indexes to the application's equality filters followed by
--    newest-first ordering.
-- 2. Make auth.uid() an RLS initPlan value instead of evaluating it per row.
-- 3. Aggregate dashboard/Books/Drive summaries in Postgres so the app no longer
--    transfers and reduces up to thousands of raw rows on every navigation.

create index if not exists workspace_members_user_active_idx
  on public.workspace_members (user_id, workspace_id)
  include (role)
  where deleted_at is null;

create index if not exists invoices_workspace_issue_created_idx
  on public.invoices (workspace_id, issue_date desc, created_at desc);
create index if not exists invoices_workspace_status_issue_created_idx
  on public.invoices (workspace_id, status, issue_date desc, created_at desc);
create index if not exists invoices_workspace_paid_idx
  on public.invoices (workspace_id, paid_at)
  where paid_at is not null;
create index if not exists invoices_workspace_sent_idx
  on public.invoices (workspace_id, sent_at)
  where sent_at is not null;

create index if not exists quotes_workspace_issue_created_idx
  on public.quotes (workspace_id, issue_date desc, created_at desc);
create index if not exists quotes_workspace_status_issue_created_idx
  on public.quotes (workspace_id, status, issue_date desc, created_at desc);
create index if not exists quotes_workspace_accepted_idx
  on public.quotes (workspace_id, accepted_at)
  where accepted_at is not null;
create index if not exists quotes_workspace_sent_idx
  on public.quotes (workspace_id, sent_at)
  where sent_at is not null;

create index if not exists book_transactions_workspace_type_date_created_idx
  on public.book_transactions (workspace_id, type, date desc, created_at desc);
create index if not exists drive_earnings_workspace_platform_date_created_idx
  on public.drive_earnings (workspace_id, platform, date desc, created_at desc);
create index if not exists drive_trips_workspace_platform_date_created_idx
  on public.drive_trips (workspace_id, platform, date desc, created_at desc);
create index if not exists driver_vehicle_expenses_workspace_vehicle_date_created_idx
  on public.driver_vehicle_expenses (workspace_id, vehicle_id, date desc, created_at desc);
create index if not exists files_workspace_created_id_idx
  on public.files (workspace_id, created_at desc, id desc);
create index if not exists notifications_workspace_user_created_id_idx
  on public.notifications (workspace_id, user_id, created_at desc, id desc);

-- Supabase's performance advisor flags bare auth.uid() calls because they may be
-- re-evaluated for every candidate row. Only the stable JWT lookup is wrapped;
-- row-dependent workspace arguments stay outside the initPlan.
alter policy users_select on public.users
  using (id = (select auth.uid()));
alter policy workspaces_select on public.workspaces
  using (public.is_workspace_member(id, (select auth.uid())));
alter policy workspace_members_select on public.workspace_members
  using (public.is_workspace_member(workspace_id, (select auth.uid())) and deleted_at is null);
alter policy workspace_invitations_select on public.workspace_invitations
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy module_installations_select on public.module_installations
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy subscriptions_select on public.subscriptions
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy credit_ledger_select on public.credit_ledger
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy activity_events_select on public.activity_events
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy audit_logs_select on public.audit_logs
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy customers_select on public.customers
  using (public.is_workspace_member(workspace_id, (select auth.uid())) and deleted_at is null);
alter policy invoices_select on public.invoices
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy invoice_line_items_select on public.invoice_line_items
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy book_transactions_select on public.book_transactions
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy drive_earnings_select on public.drive_earnings
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy drive_trips_select on public.drive_trips
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy vehicles_select on public.vehicles
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy driver_vehicle_expenses_select on public.driver_vehicle_expenses
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy driver_profiles_select on public.driver_profiles
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy quotes_select on public.quotes
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy quote_line_items_select on public.quote_line_items
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy quote_sections_select on public.quote_sections
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy quote_acceptances_select on public.quote_acceptances
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy files_select on public.files
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy receipt_extractions_select on public.receipt_extractions
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy tax_periods_select on public.tax_periods
  using (public.is_workspace_member(workspace_id, (select auth.uid())));
alter policy notifications_select on public.notifications
  using (
    public.is_workspace_member(workspace_id, (select auth.uid()))
    and user_id = (select auth.uid())
  );
alter policy ai_conversations_select on public.ai_conversations
  using (
    public.is_workspace_member(workspace_id, (select auth.uid()))
    and user_id = (select auth.uid())
  );
alter policy ai_messages_select on public.ai_messages
  using (public.is_conversation_owner(conversation_id, (select auth.uid())));

alter function public.is_workspace_member(uuid, uuid) set search_path = '';
alter function public.is_conversation_owner(uuid, uuid) set search_path = '';

create or replace function public.get_book_summary(
  p_workspace_id uuid,
  p_type public.book_type default null,
  p_date_from timestamp default null,
  p_date_to timestamp default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with filtered as (
    select type, abs(amount_cents)::bigint as amount_cents,
      abs(gst_cents)::bigint as gst_cents, date, category
    from public.book_transactions
    where workspace_id = p_workspace_id
      and (p_type is null or type = p_type)
      and (p_date_from is null or date >= p_date_from)
      and (p_date_to is null or date <= p_date_to)
  ),
  totals as (
    select
      coalesce(sum(amount_cents) filter (where type = 'income'), 0)::bigint as income_cents,
      coalesce(sum(amount_cents) filter (where type = 'expense'), 0)::bigint as expense_cents,
      coalesce(sum(gst_cents) filter (where type = 'income'), 0)::bigint as gst_collected_cents,
      coalesce(sum(gst_cents) filter (where type = 'expense'), 0)::bigint as gst_paid_cents,
      count(*)::bigint as row_count
    from filtered
  ),
  categories as (
    select type, category, sum(amount_cents)::bigint as amount_cents, count(*)::bigint as row_count
    from filtered
    group by type, category
  ),
  category_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'type', type,
          'category', category,
          'amountCents', amount_cents,
          'count', row_count
        )
        order by case when type = 'income' then 0 else 1 end, amount_cents desc
      ),
      '[]'::jsonb
    ) as value
    from categories
  ),
  months as (
    select
      to_char(date, 'YYYY-MM') as month,
      coalesce(sum(amount_cents) filter (where type = 'income'), 0)::bigint as income_cents,
      coalesce(sum(amount_cents) filter (where type = 'expense'), 0)::bigint as expense_cents
    from filtered
    group by to_char(date, 'YYYY-MM')
  ),
  month_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'month', month,
          'incomeCents', income_cents,
          'expenseCents', expense_cents,
          'netCents', income_cents - expense_cents
        )
        order by month
      ),
      '[]'::jsonb
    ) as value
    from months
  )
  select jsonb_build_object(
    'incomeCents', totals.income_cents,
    'expenseCents', totals.expense_cents,
    'netCents', totals.income_cents - totals.expense_cents,
    'gstCollectedCents', totals.gst_collected_cents,
    'gstPaidCents', totals.gst_paid_cents,
    'netGstCents', totals.gst_collected_cents - totals.gst_paid_cents,
    'count', totals.row_count,
    'byCategory', category_json.value,
    'monthly', month_json.value
  )
  from totals cross join category_json cross join month_json;
$$;

create or replace function public.get_drive_summary(
  p_workspace_id uuid,
  p_platform text default null,
  p_date_from timestamp default null,
  p_date_to timestamp default null,
  p_mileage_rate_cents_per_km integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with earnings as (
    select platform, abs(amount_cents)::bigint as amount_cents, date
    from public.drive_earnings
    where workspace_id = p_workspace_id
      and (p_platform is null or platform = p_platform)
      and (p_date_from is null or date >= p_date_from)
      and (p_date_to is null or date <= p_date_to)
  ),
  trips as (
    select platform, abs(distance_meters)::bigint as distance_meters, date
    from public.drive_trips
    where workspace_id = p_workspace_id
      and (p_platform is null or platform = p_platform)
      and (p_date_from is null or date >= p_date_from)
      and (p_date_to is null or date <= p_date_to)
  ),
  expenses as (
    select abs(amount_cents)::bigint as amount_cents
    from public.driver_vehicle_expenses
    where workspace_id = p_workspace_id
      and (p_date_from is null or date >= p_date_from)
      and (p_date_to is null or date <= p_date_to)
  ),
  platform_rows as (
    select platform, amount_cents, 0::bigint as distance_meters, 1::bigint as earnings_count,
      0::bigint as trips_count
    from earnings
    union all
    select platform, 0::bigint, distance_meters, 0::bigint, 1::bigint
    from trips
  ),
  platforms as (
    select platform, sum(amount_cents)::bigint as earnings_cents,
      sum(distance_meters)::bigint as distance_meters,
      sum(earnings_count)::bigint as earnings_count,
      sum(trips_count)::bigint as trips_count
    from platform_rows
    group by platform
  ),
  platform_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'platform', platform,
          'earningsCents', earnings_cents,
          'distanceMeters', distance_meters,
          'earningsCount', earnings_count,
          'tripsCount', trips_count
        )
        order by earnings_cents desc, platform
      ),
      '[]'::jsonb
    ) as value
    from platforms
  ),
  timeline_rows as (
    select date, amount_cents, 0::bigint as distance_meters from earnings
    union all
    select date, 0::bigint, distance_meters from trips
  ),
  months as (
    select to_char(date, 'YYYY-MM') as month,
      sum(amount_cents)::bigint as earnings_cents,
      sum(distance_meters)::bigint as distance_meters
    from timeline_rows
    group by to_char(date, 'YYYY-MM')
  ),
  month_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'month', month,
          'earningsCents', earnings_cents,
          'distanceMeters', distance_meters
        ) order by month
      ),
      '[]'::jsonb
    ) as value
    from months
  ),
  weeks as (
    select to_char(date_trunc('week', date), 'YYYY-MM-DD') as week,
      sum(amount_cents)::bigint as earnings_cents,
      sum(distance_meters)::bigint as distance_meters
    from timeline_rows
    group by to_char(date_trunc('week', date), 'YYYY-MM-DD')
  ),
  week_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'week', week,
          'earningsCents', earnings_cents,
          'distanceMeters', distance_meters
        ) order by week
      ),
      '[]'::jsonb
    ) as value
    from weeks
  ),
  totals as (
    select
      coalesce((select sum(amount_cents) from earnings), 0)::bigint as earnings_cents,
      coalesce((select sum(distance_meters) from trips), 0)::bigint as distance_meters,
      (select count(*) from earnings)::bigint as earnings_count,
      (select count(*) from trips)::bigint as trips_count,
      coalesce((select sum(amount_cents) from expenses), 0)::bigint as expenses_cents
  ),
  calculated as (
    select totals.*,
      round((distance_meters::numeric / 1000) * greatest(p_mileage_rate_cents_per_km, 0))::bigint
        as mileage_deduction_cents
    from totals
  )
  select jsonb_build_object(
    'totalEarningsCents', calculated.earnings_cents,
    'totalDistanceMeters', calculated.distance_meters,
    'earningsCount', calculated.earnings_count,
    'tripsCount', calculated.trips_count,
    'byPlatform', platform_json.value,
    'monthly', month_json.value,
    'weekly', week_json.value,
    'mileageDeductionCents', calculated.mileage_deduction_cents,
    'totalExpensesCents', calculated.expenses_cents,
    'profitCents', calculated.earnings_cents - calculated.expenses_cents
      - calculated.mileage_deduction_cents
  )
  from calculated cross join platform_json cross join month_json cross join week_json;
$$;

create or replace function public.get_invoice_dashboard_summary(
  p_workspace_id uuid,
  p_current_from timestamp default null,
  p_current_to timestamp default null,
  p_previous_from timestamp default null,
  p_previous_to timestamp default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with rows as (
    select status, total_cents::bigint, paid_at, sent_at
    from public.invoices
    where workspace_id = p_workspace_id
  ),
  totals as (
    select
      coalesce(sum(total_cents) filter (where status in ('sent', 'viewed', 'overdue')), 0)::bigint
        as outstanding_cents,
      count(*) filter (where status = 'overdue')::bigint as overdue_count,
      coalesce(sum(total_cents) filter (where status = 'overdue'), 0)::bigint as overdue_cents,
      count(*) filter (where status = 'draft')::bigint as draft_count,
      coalesce(sum(total_cents) filter (
        where status = 'paid' and paid_at is not null
          and (p_current_from is null or paid_at >= p_current_from)
          and (p_current_to is null or paid_at <= p_current_to)
      ), 0)::bigint as paid_cents,
      count(*) filter (
        where status = 'paid' and paid_at is not null
          and (p_current_from is null or paid_at >= p_current_from)
          and (p_current_to is null or paid_at <= p_current_to)
      )::bigint as paid_count,
      count(*) filter (
        where sent_at is not null
          and (p_current_from is null or sent_at >= p_current_from)
          and (p_current_to is null or sent_at <= p_current_to)
      )::bigint as sent_count,
      case when p_previous_from is null or p_previous_to is null then null
        else coalesce(sum(total_cents) filter (
          where status = 'paid' and paid_at between p_previous_from and p_previous_to
        ), 0)::bigint
      end as previous_paid_cents
    from rows
  ),
  months as (
    select to_char(paid_at, 'YYYY-MM') as month,
      sum(total_cents)::bigint as paid_cents, count(*)::bigint as paid_count
    from rows
    where status = 'paid' and paid_at is not null
      and (p_current_from is null or paid_at >= p_current_from)
      and (p_current_to is null or paid_at <= p_current_to)
    group by to_char(paid_at, 'YYYY-MM')
  ),
  month_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('month', month, 'paidCents', paid_cents, 'paidCount', paid_count)
        order by month
      ),
      '[]'::jsonb
    ) as value
    from months
  )
  select jsonb_build_object(
    'outstandingCents', totals.outstanding_cents,
    'overdueCount', totals.overdue_count,
    'overdueCents', totals.overdue_cents,
    'draftCount', totals.draft_count,
    'paidCents', totals.paid_cents,
    'paidCount', totals.paid_count,
    'sentCount', totals.sent_count,
    'previousPaidCents', totals.previous_paid_cents,
    'monthly', month_json.value
  )
  from totals cross join month_json;
$$;

create or replace function public.get_quote_dashboard_summary(
  p_workspace_id uuid,
  p_current_from timestamp default null,
  p_current_to timestamp default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with rows as (
    select status, total_cents::bigint, sent_at, accepted_at, declined_at, converted_at
    from public.quotes
    where workspace_id = p_workspace_id
  ),
  totals as (
    select
      coalesce(sum(total_cents) filter (where status = 'accepted'), 0)::bigint
        as accepted_value_cents,
      count(*) filter (where status = 'accepted')::bigint as ready_count,
      count(*) filter (
        where sent_at is not null
          and (p_current_from is null or sent_at >= p_current_from)
          and (p_current_to is null or sent_at <= p_current_to)
      )::bigint as sent_count,
      count(*) filter (
        where accepted_at is not null
          and (p_current_from is null or accepted_at >= p_current_from)
          and (p_current_to is null or accepted_at <= p_current_to)
      )::bigint as accepted_count,
      count(*) filter (
        where declined_at is not null
          and (p_current_from is null or declined_at >= p_current_from)
          and (p_current_to is null or declined_at <= p_current_to)
      )::bigint as declined_count,
      count(*) filter (
        where converted_at is not null
          and (p_current_from is null or converted_at >= p_current_from)
          and (p_current_to is null or converted_at <= p_current_to)
      )::bigint as converted_count
    from rows
  ),
  months as (
    select to_char(accepted_at, 'YYYY-MM') as month,
      sum(total_cents)::bigint as accepted_cents, count(*)::bigint as accepted_count
    from rows
    where accepted_at is not null
      and (p_current_from is null or accepted_at >= p_current_from)
      and (p_current_to is null or accepted_at <= p_current_to)
    group by to_char(accepted_at, 'YYYY-MM')
  ),
  month_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'month', month,
          'acceptedCents', accepted_cents,
          'acceptedCount', accepted_count
        ) order by month
      ),
      '[]'::jsonb
    ) as value
    from months
  )
  select jsonb_build_object(
    'acceptedValueCents', totals.accepted_value_cents,
    'readyCount', totals.ready_count,
    'sentCount', totals.sent_count,
    'acceptedCount', totals.accepted_count,
    'declinedCount', totals.declined_count,
    'convertedCount', totals.converted_count,
    'monthly', month_json.value
  )
  from totals cross join month_json;
$$;

revoke all on function public.get_book_summary(uuid, public.book_type, timestamp, timestamp)
  from public, anon, authenticated;
revoke all on function public.get_drive_summary(uuid, text, timestamp, timestamp, integer)
  from public, anon, authenticated;
revoke all on function public.get_invoice_dashboard_summary(uuid, timestamp, timestamp, timestamp, timestamp)
  from public, anon, authenticated;
revoke all on function public.get_quote_dashboard_summary(uuid, timestamp, timestamp)
  from public, anon, authenticated;

grant execute on function public.get_book_summary(uuid, public.book_type, timestamp, timestamp)
  to service_role;
grant execute on function public.get_drive_summary(uuid, text, timestamp, timestamp, integer)
  to service_role;
grant execute on function public.get_invoice_dashboard_summary(uuid, timestamp, timestamp, timestamp, timestamp)
  to service_role;
grant execute on function public.get_quote_dashboard_summary(uuid, timestamp, timestamp)
  to service_role;
