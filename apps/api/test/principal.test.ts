import { test } from 'node:test';
import assert from 'node:assert/strict';
import { securityContextDigest } from '@tailwind/semantic';
import {
  DIRECTORY_ENV,
  PrincipalDirectoryError,
  SUBJECT_HEADER,
  UnresolvedPrincipal,
  principalDirectory,
  principalOf,
  resolvePrincipal,
} from '../src/principal.ts';
import { buildApp } from '../src/app.ts';

// The app logs one line per refusal, and every case here is a refusal.
process.env['LOG_LEVEL'] ??= 'silent';

/**
 * The branches the end-to-end proof (test/e2e/rls-two-users.ts) cannot reach cheaply.
 *
 * That suite needs a warehouse and answers the question that matters -- do two people
 * get different rows. These cover the resolver's own edges: a malformed directory, a
 * tenant a caller tried to supply, a request that never went through the hook. They run
 * in `pnpm test` with no stack, which is the point: a broken resolver should fail in
 * seconds on a laptop, not in the job that boots ClickHouse.
 */

const DIRECTORY = JSON.stringify([
  { subject: 'morgan', tenant: 'internal', groups: ['analyst'] },
  { subject: 'wes', tenant: 'internal', groups: ['europe_only'] },
  { subject: 'sam', tenant: 'other_tenant', groups: ['analyst'] },
]);

/** Env is process-wide and node:test interleaves, so each case owns its own value and
 *  puts back what it found. */
function withDirectory<T>(value: string | undefined, fn: () => T): T {
  const before = process.env[DIRECTORY_ENV];
  if (value === undefined) delete process.env[DIRECTORY_ENV];
  else process.env[DIRECTORY_ENV] = value;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env[DIRECTORY_ENV];
    else process.env[DIRECTORY_ENV] = before;
  }
}

const claiming = (subject?: string): Record<string, string> =>
  subject === undefined ? {} : { [SUBJECT_HEADER]: subject };

test('with no directory configured the API answers as the permissive POC principal', () => {
  // The branch the dev loop and the walking skeleton run on. It must keep working, or
  // adding identity breaks every environment that has none (08-poc-scope.md 3.1).
  const ctx = withDirectory(undefined, () => resolvePrincipal(claiming()));
  assert.equal(ctx.tenant, 'internal');
  assert.equal(ctx.subject, 'system');
});

test('a known subject gets the tenant and groups the DIRECTORY holds', () => {
  const ctx = withDirectory(DIRECTORY, () => resolvePrincipal(claiming('wes')));
  assert.equal(ctx.tenant, 'internal');
  assert.equal(ctx.subject, 'wes');
  assert.deepEqual([...ctx.groups], ['europe_only']);
});

test('two subjects of ONE tenant resolve to two different contexts (FR-SEM-15)', () => {
  // The per-request property in its cheapest form: same tenant, different everything
  // else. A per-tenant resolution would produce one context here, and the end-to-end
  // suite is what proves the difference reaches the rows.
  const a = withDirectory(DIRECTORY, () => resolvePrincipal(claiming('morgan')));
  const b = withDirectory(DIRECTORY, () => resolvePrincipal(claiming('wes')));
  assert.equal(a.tenant, b.tenant);
  assert.notEqual(securityContextDigest(a), securityContextDigest(b));
});

test('a tenant supplied by the caller is ignored — ADR-014 D2', () => {
  // There is no header that sets a tenant. This asserts the ABSENCE, because the absence
  // is the security property: a caller who could name their tenant has the whole of
  // multi-tenancy in their hands. The tenant named here is a real one (`sam`'s), so the
  // only thing standing between the caller and it is that nothing reads the header.
  const ctx = withDirectory(DIRECTORY, () =>
    resolvePrincipal({ ...claiming('wes'), 'x-tailwind-tenant': 'other_tenant' }),
  );
  assert.equal(ctx.tenant, 'internal');
});

test('a subject with no directory entry is refused, not served (FR-SEM-14)', () => {
  assert.throws(
    () => withDirectory(DIRECTORY, () => resolvePrincipal(claiming('dana'))),
    (e: unknown) => e instanceof UnresolvedPrincipal && /resolves to no tenant/.test((e as Error).message),
  );
});

test('a request with no subject claim at all is refused', () => {
  assert.throws(() => withDirectory(DIRECTORY, () => resolvePrincipal(claiming())), UnresolvedPrincipal);
  // Blank and whitespace are not identities either -- this is the shape a proxy that
  // forwards an empty header produces, and it must not read as "no directory".
  assert.throws(() => withDirectory(DIRECTORY, () => resolvePrincipal(claiming('   '))), UnresolvedPrincipal);
});

test('a malformed directory is an operator error, not a refusal', () => {
  // Distinguished on purpose: 403 would tell fifteen pilot users they are not allowed,
  // when the truth is that one environment variable is wrong.
  assert.throws(() => withDirectory('{not json', principalDirectory), PrincipalDirectoryError);
  assert.throws(() => withDirectory('{"subject":"x"}', principalDirectory), PrincipalDirectoryError);
  assert.throws(() => withDirectory('[{"subject":"x"}]', principalDirectory), PrincipalDirectoryError);
  assert.throws(() => withDirectory('[{"tenant":"internal"}]', principalDirectory), PrincipalDirectoryError);
  assert.throws(() => withDirectory('[{"subject":"x","tenant":"t","groups":"analyst"}]', principalDirectory), PrincipalDirectoryError);
});

test('a principal with no groups is legal — it sees nothing, which is default-deny working', () => {
  const ctx = withDirectory('[{"subject":"newcomer","tenant":"internal"}]', () =>
    resolvePrincipal(claiming('newcomer')),
  );
  assert.deepEqual([...ctx.groups], []);
});

test('a context cannot be read for a request the hook never saw', () => {
  // The reason `principalOf` is a WeakMap lookup that throws rather than a decorated
  // property with a default: there is no value it could return that would be safe.
  assert.throws(() => principalOf({ method: 'GET', url: '/v1/whatever' } as never), /identity hook did not run/);
});

test('the route refuses an unresolvable principal with 403 and no envelope', async () => {
  // Deliberately not wrapped in `withDirectory`: that helper is synchronous, and
  // restoring the environment before the injected request had run would test the
  // no-directory branch while claiming to test this one.
  const before = process.env[DIRECTORY_ENV];
  process.env[DIRECTORY_ENV] = DIRECTORY;
  const app = buildApp();
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/queries',
      headers: claiming('dana'),
      payload: { query: { view: 'sales', metrics: ['sales.internet_sales'] } },
    });
    // 403 and not 401: the claim was understood, it just maps to no tenant (ADR-014 D2).
    assert.equal(res.statusCode, 403);
    const body = res.json() as Record<string, unknown>;
    assert.equal(body['code'], 'unresolved_principal');
    // No `meta` block: an envelope's security_context_digest would have to be a digest
    // of a context that was never resolved (ADR-006 D3).
    assert.equal(body['meta'], undefined);
    // Nothing was executed. The end-to-end suite proves this against a live engine by
    // counting calls; here it is enough that the handler never produced a result.
    assert.equal(body['data'], undefined);
  } finally {
    await app.close();
    if (before === undefined) delete process.env[DIRECTORY_ENV];
    else process.env[DIRECTORY_ENV] = before;
  }
});
