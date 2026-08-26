import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTenancy, NON_TENANT_TABLES } from '../src/tenancy-guard.ts';

/**
 * Stubbed client so the guard's LOGIC is testable without a live database. The CLI
 * runs the same function against the real schema in CI; this covers the branches a
 * healthy schema never reaches.
 */
interface Fixture {
  tables?: { tablename: string; rowsecurity: boolean; forcerowsecurity: boolean }[];
  tenantIdNullable?: 'YES' | 'NO' | 'missing';
  policyCount?: string;
  role?: { rolname: string; rolsuper: boolean; rolbypassrls: boolean };
}

function stub(f: Fixture) {
  const role = f.role ?? { rolname: 'tailwind_app', rolsuper: false, rolbypassrls: false };
  return {
    query: async (sql: string): Promise<{ rows: unknown[] }> => {
      if (sql.includes('relrowsecurity')) {
        return { rows: f.tables ?? [{ tablename: 'query_log', rowsecurity: true, forcerowsecurity: true }] };
      }
      if (sql.includes('information_schema.columns')) {
        return { rows: f.tenantIdNullable === 'missing' ? [] : [{ is_nullable: f.tenantIdNullable ?? 'NO' }] };
      }
      if (sql.includes('pg_policies')) return { rows: [{ count: f.policyCount ?? '1' }] };
      if (sql.includes('pg_roles')) return { rows: [role] };
      return { rows: [] };
    },
  } as never;
}
const rules = async (f: Fixture): Promise<string[]> => (await checkTenancy(stub(f))).map((x) => x.rule);

test('a sound schema on a non-superuser role produces no findings', async () => {
  assert.deepEqual(await rules({}), []);
});

test('connecting as a SUPERUSER is a finding — this is the incident T-130 exists for', async () => {
  // ADR-014's backstop shipped complete and inert: correct policy, ENABLE and FORCE
  // both set, and a wrong-tenant session still read every row.
  const found = await rules({ role: { rolname: 'tailwind', rolsuper: true, rolbypassrls: true } });
  assert.ok(found.includes('connects-as-superuser'));
  assert.ok(found.includes('role-has-bypassrls'));
});

test('a guard that only inspected pg_policies would have passed that schema', async () => {
  // Every TABLE-level check is clean here; only the role check fires. That is exactly
  // why the guard must look at the connecting role.
  const found = await rules({ role: { rolname: 'tailwind', rolsuper: true, rolbypassrls: false } });
  assert.deepEqual(found, ['connects-as-superuser']);
});

test('a tenant-scoped table with no tenant_id is a finding', async () => {
  assert.ok((await rules({ tenantIdNullable: 'missing' })).includes('missing-tenant-id'));
});

test('a nullable tenant_id is a finding — a null tenant belongs to everyone', async () => {
  assert.ok((await rules({ tenantIdNullable: 'YES' })).includes('nullable-tenant-id'));
});

test('RLS disabled, or enabled without FORCE, are both findings', async () => {
  assert.ok((await rules({ tables: [{ tablename: 'x', rowsecurity: false, forcerowsecurity: false }] })).includes('rls-disabled'));
  assert.ok((await rules({ tables: [{ tablename: 'x', rowsecurity: true, forcerowsecurity: false }] })).includes('rls-not-forced'));
});

test('RLS enabled with no policy is a finding', async () => {
  assert.ok((await rules({ policyCount: '0' })).includes('no-policy'));
});

test('the non-tenant allow-list is explicit, not inferred', async () => {
  assert.ok(NON_TENANT_TABLES.has('tenants'), 'the tenant registry is what tenants are scoped TO');
  const found = await rules({ tables: [{ tablename: 'tenants', rowsecurity: false, forcerowsecurity: false }] });
  assert.deepEqual(found, [], 'an allow-listed table is skipped entirely');
});
