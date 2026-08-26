-- Operational state only. 07-domain-model.md section 2: git holds what humans review,
-- the database holds runtime and personal state, and NOTHING here may change a number.
-- The security context may restrict rows and mask columns; it may never redefine a metric.

-- The tenant registry itself is NOT tenant-scoped: it is the thing tenants are scoped to.
-- Recorded in the allow-list the T-130 guard reads.
CREATE TABLE IF NOT EXISTS tenants (
  slug        text PRIMARY KEY,
  title       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- FR-SEC-07: immutable audit of query execution -- who, what, which SQL, how long.
-- Append-only by policy; no UPDATE or DELETE grant is ever issued to the app role.
CREATE TABLE IF NOT EXISTS query_log (
  id                       bigserial PRIMARY KEY,
  tenant_id                text NOT NULL REFERENCES tenants(slug),
  subject                  text NOT NULL,
  security_context_digest  text NOT NULL,
  dashboard                text,
  view_name                text NOT NULL,
  metrics                  text[] NOT NULL,
  generated_sql            text,
  row_count                integer,
  duration_ms              integer NOT NULL,
  trace_id                 text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS query_log_tenant_created ON query_log (tenant_id, created_at DESC);

-- ADR-014: RLS as the BACKSTOP, not the primary mechanism. The app always filters by
-- tenant; this is what makes a forgotten WHERE clause a no-op instead of a leak.
ALTER TABLE query_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS query_log_tenant_isolation ON query_log;
CREATE POLICY query_log_tenant_isolation ON query_log
  USING (tenant_id = current_setting('tailwind.tenant_id', true));

INSERT INTO tenants (slug, title) VALUES ('internal', 'Internal')
  ON CONFLICT (slug) DO NOTHING;
