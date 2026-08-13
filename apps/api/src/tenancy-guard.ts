import type pg from 'pg';

/**
 * T-130. Every tenant-scoped table must carry `tenant_id NOT NULL` and have row-level
 * security enabled, AND the application must connect as a role that RLS actually
 * applies to.
 *
 * That last clause is the whole point. ADR-014's backstop was shipped complete and
 * inert: correct policy, ENABLE plus FORCE ROW LEVEL SECURITY, transaction-local
 * tenant — and a wrong-tenant session still read every row, because the app connected
 * as a superuser and superusers bypass RLS entirely. A guard that inspected
 * `pg_policies` and stopped there would have passed that schema cleanly.
 */

/** Tables that are legitimately NOT tenant-scoped. Explicit, because a silent
 *  exemption is how a tenant-scoped table sneaks through unguarded. */
export const NON_TENANT_TABLES = new Set(['tenants']);

export interface GuardFinding {
  object: string;
  rule: string;
  message: string;
}

export async function checkTenancy(client: pg.PoolClient | pg.Pool): Promise<GuardFinding[]> {
  const findings: GuardFinding[] = [];
  const add = (object: string, rule: string, message: string): void => {
    findings.push({ object, rule, message });
  };

  const { rows: tables } = await client.query<{ tablename: string; rowsecurity: boolean; forcerowsecurity: boolean }>(
    `SELECT c.relname AS tablename, c.relrowsecurity AS rowsecurity, c.relforcerowsecurity AS forcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'`,
  );

  for (const t of tables) {
    if (NON_TENANT_TABLES.has(t.tablename)) continue;

    const { rows: cols } = await client.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'tenant_id'`,
      [t.tablename],
    );
    if (cols.length === 0) {
      add(t.tablename, 'missing-tenant-id',
        'tenant-scoped table has no tenant_id column; add one or add the table to NON_TENANT_TABLES with a reason');
    } else if (cols[0]?.is_nullable === 'YES') {
      add(t.tablename, 'nullable-tenant-id', 'tenant_id must be NOT NULL: a null tenant belongs to everyone');
    }

    if (!t.rowsecurity) add(t.tablename, 'rls-disabled', 'row-level security is not enabled');
    // FORCE closes the OWNER loophole. It does not close the superuser one -- see below.
    if (!t.forcerowsecurity) {
      add(t.tablename, 'rls-not-forced', 'FORCE ROW LEVEL SECURITY is off, so the table owner bypasses the policy');
    }

    const { rows: policies } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`,
      [t.tablename],
    );
    if (policies[0]?.count === '0') add(t.tablename, 'no-policy', 'RLS is enabled but no policy exists, so nothing is readable or nothing is filtered');
  }

  /**
   * The check the incident actually needed. A policy is decoration if the connecting
   * role can bypass it, and both superuser and BYPASSRLS do exactly that.
   */
  const { rows: role } = await client.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
    'SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
  );
  const me = role[0];
  if (me === undefined) {
    add('current_user', 'role-unknown', 'could not resolve the connecting role');
  } else {
    if (me.rolsuper) {
      add(me.rolname, 'connects-as-superuser',
        'the application connects as a SUPERUSER, which bypasses row-level security entirely -- every policy above is inert');
    }
    if (me.rolbypassrls) {
      add(me.rolname, 'role-has-bypassrls', 'the connecting role has BYPASSRLS, so policies do not apply to it');
    }
  }

  return findings;
}

export function formatFindings(findings: GuardFinding[]): string {
  return findings.map((f) => `  [${f.rule}] ${f.object}: ${f.message}`).join('\n');
}
