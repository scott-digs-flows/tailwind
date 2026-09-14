import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compile,
  applyRowLimit,
  pocSystemContext,
  securityContextDigest,
  resolveSecurityContext,
  DEFAULT_ROW_LIMIT,
} from '../src/index.ts';

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
  const { engineQuery, rowLimit } = compile({ view: 'sales', metrics: ['sales.revenue'] }, ctx);
  assert.equal(rowLimit, DEFAULT_ROW_LIMIT);
  // One MORE than the cap is requested on purpose: it is the probe that makes hitting
  // the cap detectable. Without it a truncated result is indistinguishable from a
  // complete one, and renders as a confident chart with a wrong number.
  assert.equal(engineQuery['limit'], DEFAULT_ROW_LIMIT + 1);
});

test('an author asking for fewer rows is not probed and never warned (FR-ADM-03)', () => {
  const { engineQuery, rowLimit, capBinds } = compile(
    { view: 'sales', metrics: ['sales.revenue'], limit: 10 },
    ctx,
  );
  assert.equal(rowLimit, 10);
  assert.equal(capBinds, false);
  // No probe row: a "Top 10" chart got exactly what it asked for. Probing would buy a
  // row we have nothing to say about, and reporting it would put a warning on a chart
  // that is behaving correctly -- which teaches people to ignore warnings.
  assert.equal(engineQuery['limit'], 10);
  assert.deepEqual(applyRowLimit([{}, {}, {}], 10, capBinds), {
    rows: [{}, {}, {}],
    truncated: false,
  });
});

test('an author asking for more than the cap is capped, and told (FR-ADM-03)', () => {
  const { engineQuery, rowLimit, capBinds } = compile(
    { view: 'sales', metrics: ['sales.revenue'], limit: 999999 },
    ctx,
  );
  assert.equal(rowLimit, DEFAULT_ROW_LIMIT);
  assert.equal(capBinds, true);
  assert.equal(engineQuery['limit'], DEFAULT_ROW_LIMIT + 1);
});

test('the probe row is dropped and reported, never plotted (FR-ADM-03)', () => {
  const four = [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }];
  // Cap is 3 and the engine returned 4: the fourth is the probe.
  const hit = applyRowLimit(four, 3, true);
  assert.equal(hit.truncated, true);
  assert.equal(hit.rows.length, 3, 'the probe row must never reach a chart');
  assert.deepEqual(hit.rows, four.slice(0, 3));

  // Exactly at the cap is NOT truncation -- an off-by-one here silently mislabels
  // every full result as incomplete.
  const exact = applyRowLimit(four.slice(0, 3), 3, true);
  assert.equal(exact.truncated, false);
  assert.equal(exact.rows.length, 3);
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
