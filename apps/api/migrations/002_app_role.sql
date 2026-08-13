-- ADR-014's RLS backstop is DECORATIVE unless the app connects as a non-superuser.
-- POSTGRES_USER is a superuser, and superusers bypass row-level security entirely --
-- FORCE ROW LEVEL SECURITY does not change that. Found 2026-08-12 by asserting the
-- backstop rather than assuming it: a wrong-tenant session still saw every row.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tailwind_app') THEN
    EXECUTE format('CREATE ROLE tailwind_app LOGIN PASSWORD %L', current_setting('tailwind.app_password', true));
  END IF;
END $$;

-- Least privilege: read and append. No UPDATE, no DELETE -- FR-SEC-07 says the audit
-- log is immutable, and the cheapest way to mean it is to withhold the grant.
GRANT USAGE ON SCHEMA public TO tailwind_app;
GRANT SELECT, INSERT ON query_log TO tailwind_app;
GRANT USAGE, SELECT ON SEQUENCE query_log_id_seq TO tailwind_app;
GRANT SELECT ON tenants TO tailwind_app;

-- Explicitly NOT granted: BYPASSRLS. Stated so nobody adds it for convenience.
ALTER ROLE tailwind_app NOBYPASSRLS;
