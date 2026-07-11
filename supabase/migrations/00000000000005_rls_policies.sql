-- Row Level Security policies (defense-in-depth).
--
-- 0004 enabled RLS on every table; this migration adds the matching SELECT policies.
-- The application reads/writes ALL business data through the service_role key, which
-- bypasses RLS — so these policies are NOT exercised by any app code path today. They are a
-- safety net: they activate only if a future code path reads via the anon/cookie client, or if
-- someone hits PostgREST directly with the anon key.
--
-- Design:
--  * Coarse boundary: a user may SELECT only rows in workspaces where they hold an ACTIVE
--    membership (workspace_members row with deleted_at IS NULL, parent workspace not
--    soft-deleted). Role-agnostic — the fine-grained verb:resource matrix (view:R / manage:R
--    etc.) stays in app code (authorizeOrAudit). RLS is NOT the place to encode roles.
--  * User-scoped tables (notifications, ai_conversations, ai_messages) additionally require
--    user_id = auth.uid(). ai_messages has no workspace_id/user_id column, so it is scoped via
--    its parent conversation (is_conversation_owner).
--  * Recursion-safe: the membership check is a SECURITY DEFINER function (runs as the postgres
--    owner, bypassing RLS) so policies referencing workspace_members/workspaces do not recurse.
--    auth.uid() is evaluated in the POLICY (caller context, where the JWT lives) and passed in
--    as a parameter — it is never called inside the function body.
--  * SELECT only. There are deliberately NO INSERT/UPDATE/DELETE policies, so writes are denied
--    to the authenticated/anon roles; the service_role key bypasses RLS, so app writes work.
--    This intentionally locks all writes to the server-side service-role path. If a future
--    feature ever needs anon writes, add a write policy in a new migration — don't widen this
--    one.
--  * Public-token reads (invoices/quotes by public_token) stay server-side via the service-role
--    client; anon PostgREST access to those tables is denied (membership only), so the sanitized
--    public view the code returns is the only public surface. Do NOT add a public-token SELECT
--    policy here — it would leak the internal ids/notes/stripe ids the service carefully strips.
--  * processed_webhook_events (global, no workspace/user) intentionally gets NO policy → denied
--    to all non-bypass roles; the Stripe webhook handler reads/writes it via the service_role
--    key. Do NOT add a policy for it.
--
-- Companion GRANT: migration 0002 granted DML to service_role ONLY (anon/authenticated were
-- deliberately left without table DML so the then-policy-less RLS couldn't leak rows). That made
-- the SELECT policies below unreachable — an authenticated PostgREST request failed with 42501
-- "permission denied for table" before RLS ran. This migration therefore also GRANTs SELECT to
-- `authenticated` (and only authenticated — anon stays hard-blocked at the GRANT layer, matching
-- the app's auth-only anon client; there are no public anon-readable tables). With SELECT granted
-- to authenticated, the policies below become the live boundary. anon retains no SELECT, so it
-- gets 42501 regardless — belt-and-suspenders: even a future buggy anon policy can't leak rows
-- because anon has no table-level SELECT privilege.

-- ---------------------------------------------------------------------------
-- Table-level SELECT grant to authenticated (makes the policies below reachable).
-- ---------------------------------------------------------------------------
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT ON TABLES TO authenticated;

-- ---------------------------------------------------------------------------
-- Membership helpers (SECURITY DEFINER → bypasses RLS on referenced tables).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members AS wm
    JOIN public.workspaces AS w ON w.id = wm.workspace_id
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = p_user_id
      AND wm.deleted_at IS NULL
      AND w.deleted_at IS NULL
  );
$$;

-- Conversation-owner helper (for ai_messages, which has no workspace_id/user_id column).
CREATE OR REPLACE FUNCTION public.is_conversation_owner(p_conversation_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ai_conversations AS c
    WHERE c.id = p_conversation_id
      AND c.user_id = p_user_id
      AND public.is_workspace_member(c.workspace_id, p_user_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_conversation_owner(uuid, uuid) TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- Per-table SELECT policies.
-- ---------------------------------------------------------------------------

-- Users: a user reads only their own mirror row. (Also blocks email leakage via anon
-- resource-embedding — a member listing members via anon would only see their own email.)
CREATE POLICY users_select ON public.users
  FOR SELECT TO authenticated USING (id = auth.uid());

-- Workspaces: a user sees workspaces they hold an active membership in. The function's
-- w.deleted_at IS NULL check hides soft-deleted workspaces.
CREATE POLICY workspaces_select ON public.workspaces
  FOR SELECT TO authenticated USING (public.is_workspace_member(id, auth.uid()));

-- Workspace members: a member sees active (non-soft-deleted) members of their own workspace.
CREATE POLICY workspace_members_select ON public.workspace_members
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()) AND deleted_at IS NULL);

-- Workspace invitations: members see invites for their workspace. The public /invite/[token]
-- accept page looks the invite up by token via the service-role client, which bypasses RLS.
CREATE POLICY workspace_invitations_select ON public.workspace_invitations
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));

-- Module installations / subscriptions / credit ledger: members see their workspace's state.
CREATE POLICY module_installations_select ON public.module_installations
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY subscriptions_select ON public.subscriptions
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY credit_ledger_select ON public.credit_ledger
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));

-- Activity / audit feeds: members see their workspace's events.
CREATE POLICY activity_events_select ON public.activity_events
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));

-- Customers: members see active (non-soft-deleted) customers of their workspace.
CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()) AND deleted_at IS NULL);

-- Invoices + line items.
CREATE POLICY invoices_select ON public.invoices
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY invoice_line_items_select ON public.invoice_line_items
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));

-- Books.
CREATE POLICY book_transactions_select ON public.book_transactions
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));

-- Drive.
CREATE POLICY drive_earnings_select ON public.drive_earnings
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY drive_trips_select ON public.drive_trips
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY vehicles_select ON public.vehicles
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY driver_vehicle_expenses_select ON public.driver_vehicle_expenses
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY driver_profiles_select ON public.driver_profiles
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));

-- Quotes + line items + sections + acceptances.
CREATE POLICY quotes_select ON public.quotes
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY quote_line_items_select ON public.quote_line_items
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY quote_sections_select ON public.quote_sections
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY quote_acceptances_select ON public.quote_acceptances
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));

-- Files + receipt extractions.
CREATE POLICY files_select ON public.files
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY receipt_extractions_select ON public.receipt_extractions
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));

-- Tax periods.
CREATE POLICY tax_periods_select ON public.tax_periods
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));

-- User-scoped (per-user within a workspace): membership AND own user_id.
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()) AND user_id = auth.uid());
CREATE POLICY ai_conversations_select ON public.ai_conversations
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()) AND user_id = auth.uid());

-- ai_messages has no workspace_id/user_id — scoped via its parent conversation.
CREATE POLICY ai_messages_select ON public.ai_messages
  FOR SELECT TO authenticated USING (public.is_conversation_owner(conversation_id, auth.uid()));

-- processed_webhook_events: intentionally NO policy → denied to all non-bypass roles.
-- The Stripe webhook handler reads/writes it via the service_role key (bypasses RLS).