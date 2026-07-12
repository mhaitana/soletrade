-- Declare the actor→users relationship for the audit + activity feeds (Phase 3).
--
-- `audit_logs.actor_user_id` and `activity_events.actor_user_id` both reference
-- `users.id` (the Supabase Auth user mirror), but the Drizzle schema modeled this as
-- an undeclared leftJoin - there was no FK constraint. PostgREST resource embedding
-- needs a declared FK to resolve a join, so `.select("..., users ( full_name )")` (the
-- way the audit/activity reads resolve the actor's display name in one query) requires
-- this. Declaring the FK is also the correct data model: these columns genuinely
-- reference a user.
--
-- `ON DELETE SET NULL` keeps the audit/activity trail intact when an auth user is
-- deleted (the actor name just becomes null), which is better than the pre-existing
-- orphaned-reference behavior. `NOT VALID` skips validating rows that may already
-- exist on the remote when this migration is pushed (Phase 7) - every current
-- actor_user_id is a real user, but NOT VALID makes the push safe regardless; future
-- inserts/updates are still enforced. PostgREST reads FK relationships from
-- pg_catalog regardless of validity, so resource embedding resolves either way.

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_actor_user_id_users_fk
  FOREIGN KEY (actor_user_id) REFERENCES public.users (id)
  ON DELETE SET NULL NOT VALID;

ALTER TABLE public.activity_events
  ADD CONSTRAINT activity_events_actor_user_id_users_fk
  FOREIGN KEY (actor_user_id) REFERENCES public.users (id)
  ON DELETE SET NULL NOT VALID;