import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, pocSystemContext, securityContextDigest, resolveSecurityContext } from '../src/index.ts';

const ctx = pocSystemContext();

test('a metric, a dimension and a filter compile to the engine shape', () => {
  const { engineQuery } = compile(
    {
      view: 'sales',
      metrics: ['sales.revenue'],
      dimensions: ['sales.region'],
      filters: [{ member: 'sales.category', operator: 'equals', values: ['Bikes'] }],
      order: [{ member: 'sales.revenue', dir: 'desc' }],
    },
    ctx,
  );
  assert.deepEqual(engineQuery['measures'], ['sales.revenue']);
  assert.deepEqual(engineQuery['dimensions'], ['sales.region']);
  assert.deepEqual(engineQuery['filters'], [{ member: 'sales.category', operator: 'equals', values: ['Bikes'] }]);
  assert.deepEqual(engineQuery['order'], [['sales.revenue', 'desc']]);
});

test('a time dimension becomes a granularity request', () => {
  const { engineQuery } = compile(
    { view: 'sales', metrics: ['sales.revenue'], time_dimensions: [{ member: 'sales.order_date', granularity: 'month' }] },
    ctx,
  );
  assert.deepEqual(engineQuery['timeDimensions'], [{ dimension: 'sales.order_date', granularity: 'month' }]);
});

test('a member outside the view is refused — cubes are private (FR-SEM-02)', () => {
  assert.throws(
    () => compile({ view: 'sales', metrics: ['orders.revenue'] }, ctx),
    /outside view 'sales'/,
  );
});

test('a row cap is always applied (FR-ADM-03)', () => {
  const { engineQuery } = compile({ view: 'sales', metrics: ['sales.revenue'] }, ctx);
  assert.equal(engineQuery['limit'], 10000);
});

test('the security context cannot be omitted, at compile time or run time (FR-SEM-14)', () => {
  // Type level: there is deliberately no overload that drops the context. If someone
  // adds one, this stops compiling and the @ts-expect-error becomes the error.
  // @ts-expect-error
  const _typeGuard = () => compile({ view: 'sales', metrics: ['sales.revenue'] });
  void _typeGuard;

  // Run time: the AI path and any dynamic caller arrive from plain JS.
  assert.throws(
    // @ts-expect-error -- deliberately bypassing the type to exercise the guard.
    () => compile({ view: 'sales', metrics: ['sales.revenue'] }, undefined),
    /requires a resolved SecurityContext/,
  );
});

test('two different subjects produce different digests (FR-SEM-15)', () => {
  const a = resolveSecurityContext({ tenant: 'internal', subject: 'morgan', groups: ['sales'] });
  const b = resolveSecurityContext({ tenant: 'internal', subject: 'priya', groups: ['sales'] });
  assert.notEqual(securityContextDigest(a), securityContextDigest(b));
});

test('group order does not change the digest', () => {
  const a = resolveSecurityContext({ tenant: 'internal', subject: 'x', groups: ['a', 'b'] });
  const b = resolveSecurityContext({ tenant: 'internal', subject: 'x', groups: ['b', 'a'] });
  assert.equal(securityContextDigest(a), securityContextDigest(b));
});

test('a context with no tenant is rejected, not served (FR-SEM-14)', () => {
  assert.throws(() => resolveSecurityContext({ tenant: '', subject: 'x', groups: [] }), /requires a tenant/);
});
