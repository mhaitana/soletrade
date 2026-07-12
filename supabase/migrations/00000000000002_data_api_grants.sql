-- Data-API grants (Phase 3 of the Drizzle -> Supabase migration).
--
-- Drizzle connected to the database as the `postgres` superuser/owner over a direct
-- connection string, so it never needed explicit GRANTs. The Supabase data client talks
-- to PostgREST (the HTTP API), which runs each request as the role encoded in the JWT -
-- for this project, `service_role` (the service-role admin client; see
-- `src/server/db/client.ts`). The consolidated Drizzle baseline migration created all 29
-- tables without granting DML to any Data API role, so `service_role` had only the
-- structural grants (REFERENCES/TRIGGER/TRUNCATE) Supabase adds by default - and every
-- direct `.from(table).select()/insert()/update()/delete()` failed with SQLSTATE 42501
-- "permission denied for table". (The Phase-2 atomic writers didn't hit this because
-- they are PL/pgSQL `SECURITY DEFINER` functions running as their `postgres` owner.)
--
-- This grants DML on all public-schema tables + sequence USAGE + function EXECUTE to the
-- `service_role` only. `anon` and `authenticated` are deliberately NOT granted DML: there
-- is no client-side table access in this app (the browser Supabase client is auth-only),
-- and with no RLS policies in place granting them DML would expose every row to anyone
-- holding the public anon key. RLS hardening is a separate, explicitly out-of-scope
-- follow-up for this migration; this grant keeps the service-role data path working
-- without widening exposure beyond the pre-existing (Drizzle-as-postgres) state.
--
-- `ALTER DEFAULT PRIVILEGES` covers tables/sequences/functions added by future
-- migrations authored as `postgres`, so new tables get the same grants automatically.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;