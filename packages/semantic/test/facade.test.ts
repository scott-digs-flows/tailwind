import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compile,
  prepareQuery,
  runQuery,
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

test('an ORDERED Top-N is not probed and never warned (FR-ADM-03)', () => {
  const { engineQuery, rowLimit, reportTruncation } = compile(
    {
      view: 'sales',
      metrics: ['sales.revenue'],
      limit: 10,
      order: [{ member: 'sales.revenue', dir: 'desc' }],
    },
    ctx,
  );
  assert.equal(rowLimit, 10);
  assert.equal(reportTruncation, false);
  // No probe row: the author picked the ten they meant. Reporting it would put a
  // warning on a chart behaving correctly, every load -- which teaches people to
  // ignore the channel.
  assert.equal(engineQuery['limit'], 10);
});

test('an UNORDERED author limit is still truncation (FR-ADM-03, FR-VIZ-13)', () => {
  // The case the first version of this rule missed entirely: `limit` with no `order`
  // returns whichever rows the engine reaches first, and the author almost certainly
  // believed that was all of them. Silent below the 10,000 cap is still silent.
  const { engineQuery, rowLimit, reportTruncation } = compile(
    { view: 'sales', metrics: ['sales.revenue'], limit: 500 },
    ctx,
  );
  assert.equal(rowLimit, 500);
  assert.equal(reportTruncation, true);
  assert.equal(engineQuery['limit'], 501, 'must probe: there may be a 501st row');
  const probed = Array.from({ length: 501 }, (_, i) => ({ i }));
  const out = applyRowLimit(probed, 500, reportTruncation);
  assert.equal(out.truncated, true);
  assert.equal(out.rows.length, 500, 'the probe row is never data');
});

test('the probe row is dropped even when truncation is not reported', () => {
  // Reporting is conditional; slicing never is. If these two ever diverge, an ordered
  // Top-10 quietly renders eleven points.
  const out = applyRowLimit([{}, {}, {}], 2, false);
  assert.equal(out.rows.length, 2);
  assert.equal(out.truncated, false);
});

test('an author asking for more than the cap is capped, and told (FR-ADM-03)', () => {
  const { engineQuery, rowLimit, reportTruncation } = compile(
    { view: 'sales', metrics: ['sales.revenue'], limit: 999999 },
    ctx,
  );
  assert.equal(rowLimit, DEFAULT_ROW_LIMIT);
  assert.equal(reportTruncation, true);
  assert.equal(engineQuery['limit'], DEFAULT_ROW_LIMIT + 1);
});

test('an ordered request ABOVE the cap is still capped and reported (FR-ADM-03)', () => {
  // `order` only excuses a limit the author chose. The cap is not their choice.
  const { rowLimit, reportTruncation } = compile(
    {
      view: 'sales',
      metrics: ['sales.revenue'],
      limit: 50000,
      order: [{ member: 'sales.revenue', dir: 'desc' }],
    },
    ctx,
  );
  assert.equal(rowLimit, DEFAULT_ROW_LIMIT);
  assert.equal(reportTruncation, true);
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

test('the freshness class cannot be omitted, at compile time or run time (FR-FRESH-02)', async () => {
  // Type level, the same guard the security context has and for the same reason: the
  // class is a governed property (FR-FRESH-01/04), so a caller that may leave it out is
  // a caller that silently picks a cache policy and a cost. If someone adds an overload
  // or a default, this stops erroring and the @ts-expect-error becomes the failure.
  // @ts-expect-error
  const _typeGuard = () => runQuery(ctx, { view: 'sales', metrics: ['sales.revenue'] });
  void _typeGuard;

  // Run time: the AI path and a request body arrive as plain strings. Refused rather
  // than mapped onto `standard` -- and refused before the engine is touched, so this
  // needs no stack running.
  await assert.rejects(
    // @ts-expect-error -- deliberately bypassing the type to exercise the guard.
    () => runQuery(ctx, { view: 'sales', metrics: ['sales.revenue'] }, 'whenever'),
    /requires a FreshnessClass/,
  );
});

test('the class reaches execution as a policy, and never the compiled query', () => {
  // The distinction the ticket turns on. The class must change what the CACHE does and
  // nothing about what the WAREHOUSE is asked -- a freshness class that altered the
  // compiled query would be a second way to change a number, which binding constraint 2
  // exists to prevent.
  const batch = prepareQuery(ctx, { view: 'sales', metrics: ['sales.revenue'] }, 'batch');
  const operational = prepareQuery(ctx, { view: 'sales', metrics: ['sales.revenue'] }, 'operational');
  assert.deepEqual(batch.compiled.engineQuery, operational.compiled.engineQuery);
  assert.equal(batch.cacheLookup.policy.ttlSeconds, 24 * 60 * 60);
  assert.equal(operational.cacheLookup.policy.ttlSeconds, 0, 'operational has no meaningful result cache');
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
