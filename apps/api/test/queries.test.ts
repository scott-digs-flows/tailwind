import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { pocSystemContext, runQuery } from '@tailwind/semantic';
import { FRESHNESS_CLASSES, cachePolicyFor } from '@tailwind/spec';
import { resolveQuery, type QueryRequestBody } from '../src/queries.ts';
import { registerRoutes } from '../src/routes.ts';
import { close } from '../src/db.ts';

/**
 * TW-167. The freshness class is resolved server-side; a class in a request body is
 * ignored.
 *
 * The assertion that matters is NOT that the response envelope reports the right class.
 * An envelope that reports `standard` while a cache was bypassed because someone asked
 * for `operational` is precisely the bug -- it looks correct from the outside and costs
 * money on every load. So the adversarial cases below assert on the CachePolicy the
 * facade derived from the class it was handed (`cacheLookup.policy`), which is the value
 * a store will read once TW-44 installs one, and the envelope is checked separately as
 * the end-to-end half.
 *
 * Negative control: put `isFreshnessClass(body.freshness) ? body.freshness : DEFAULT`
 * back into the resolution and four tests here fail, two of them on the policy rather
 * than the label. A suite that still passes with the mechanism removed is testing
 * nothing.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

// The published artifact this API serves, for the duration of this file. Read per call
// (apps/api/src/content.ts), so setting it here is enough -- no import-order dance.
process.env['TAILWIND_CONTENT_ROOT'] = join(HERE, 'fixtures', 'content');

const ctx = pocSystemContext();
const PUBLISHED = { dashboard: 'nightly_margin', id: 'margin_by_month' };
/** What the fixture declares, and what nothing in a request may change. */
const PUBLISHED_CLASS = 'batch';
const AD_HOC_QUERY = { view: 'sales', metrics: ['sales.revenue'] };

/**
 * A body as it actually arrives: parsed JSON with whatever fields the caller chose to
 * send. `QueryRequestBody` deliberately does not declare `freshness`, so this cast is
 * how a test writes the request an attacker writes.
 */
const body = (o: Record<string, unknown>): QueryRequestBody => o as QueryRequestBody;

/** The last query the engine was asked to run, so a test can see what EXECUTED. */
let lastEngineQuery: Record<string, unknown> | undefined;

let engine: Server;
let app: FastifyInstance;

before(async () => {
  // A stand-in for Cube. The facade reads its endpoint from the environment on every
  // call (engine-config.ts), so pointing it here needs no injection seam -- which
  // matters: a test-only way to hand the facade a different engine is a second door.
  engine = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const sent = JSON.parse(raw === '' ? '{}' : raw) as { query?: Record<string, unknown> };
      lastEngineQuery = sent.query;
      res.setHeader('content-type', 'application/json');
      res.end(
        req.url?.endsWith('/sql') === true
          ? JSON.stringify({ sql: { sql: ['SELECT 1', []] } })
          : JSON.stringify({
              results: [
                {
                  data: [{ 'sales.margin': 1, 'sales.revenue': 2 }],
                  annotation: {},
                  lastRefreshTime: '2026-09-15T00:00:00.000Z',
                },
              ],
            }),
      );
    });
  });
  await new Promise<void>((resolve) => engine.listen(0, '127.0.0.1', resolve));
  process.env['CUBE_URL'] = `http://127.0.0.1:${(engine.address() as AddressInfo).port}/cubejs-api/v1`;

  app = Fastify();
  registerRoutes(app);
  await app.ready();
});

after(async () => {
  await app.close();
  await new Promise<void>((resolve) => engine.close(() => resolve()));
  // The route's audit write is fire-and-forget against Postgres, which is not running
  // here; it fails, logs and is swallowed. Closing the pool keeps the runner from
  // holding a handle open on the way out.
  await close();
});

test('the class is read from the published artifact', () => {
  const governed = resolveQuery(ctx, body({ chart: PUBLISHED }));
  assert.equal(governed.freshness, PUBLISHED_CLASS);
  // And the query is the artifact's too. Resolving only the class from the artifact
  // while still executing the caller's query leaves the escalation intact one level up:
  // name an expensive dashboard, send any query, collect the class it was granted.
  assert.deepEqual(governed.query, {
    view: 'sales',
    metrics: ['sales.margin'],
    time_dimensions: [{ member: 'sales.order_date', granularity: 'month' }],
  });
  assert.equal(governed.dashboard, 'nightly_margin');
});

test('an ad-hoc query gets the server default, not a caller-chosen class', () => {
  const governed = resolveQuery(ctx, body({ query: AD_HOC_QUERY }));
  assert.equal(governed.freshness, 'standard');
  assert.equal(governed.dashboard, undefined, 'an unreviewed query names no artifact');
});

test('asking for a class in the body changes NOTHING about the resolution', () => {
  // Every class, both paths, compared against the same request without the field. Not
  // "the answer is standard" -- "the field is inert", which is the property that stays
  // true when DEFAULT_FRESHNESS or the fixture's class changes.
  const publishedBaseline = resolveQuery(ctx, body({ chart: PUBLISHED }));
  const adHocBaseline = resolveQuery(ctx, body({ query: AD_HOC_QUERY }));
  for (const asked of FRESHNESS_CLASSES) {
    assert.deepEqual(resolveQuery(ctx, body({ chart: PUBLISHED, freshness: asked })), publishedBaseline);
    assert.deepEqual(resolveQuery(ctx, body({ query: AD_HOC_QUERY, freshness: asked })), adHocBaseline);
  }
  // Junk is inert for the same reason: there is no parameter it could arrive through,
  // so it needs no validation and cannot be mapped onto a default by mistake.
  assert.deepEqual(resolveQuery(ctx, body({ query: AD_HOC_QUERY, freshness: 'realtime' })), adHocBaseline);
});

test('asking for `operational` does not change the policy execution runs under', async () => {
  // The assertion this ticket exists for. `cacheLookup.policy` is derived inside the
  // facade from the class it was HANDED, downstream of anything the envelope says.
  const governed = resolveQuery(ctx, body({ chart: PUBLISHED, freshness: 'operational' }));
  const result = await runQuery(ctx, governed.query, governed.freshness);

  assert.equal(result.cacheLookup.policy.class, PUBLISHED_CLASS);
  assert.deepEqual(result.cacheLookup.policy, cachePolicyFor(PUBLISHED_CLASS));
  // The concrete harm, spelled out: `operational` is ttl 0, which means every load goes
  // to the warehouse. The published class keeps its day-long TTL.
  assert.equal(cachePolicyFor('operational').ttlSeconds, 0);
  assert.equal(result.cacheLookup.policy.ttlSeconds, 24 * 60 * 60);
  assert.equal(result.freshness, PUBLISHED_CLASS);
});

test('the same, for an ad-hoc query: the default policy, not the one asked for', async () => {
  const governed = resolveQuery(ctx, body({ query: AD_HOC_QUERY, freshness: 'operational' }));
  const result = await runQuery(ctx, governed.query, governed.freshness);
  assert.equal(result.cacheLookup.policy.class, 'standard');
  assert.equal(result.cacheLookup.policy.ttlSeconds, 30 * 60);
});

test('the freshness class is still nowhere near the cache KEY (TW-168)', async () => {
  // Resolving the class server-side must not quietly turn it into part of the entry's
  // identity: two classes over one query are the same numbers for the same user, and
  // keying them apart halves the hit rate for nothing (packages/semantic/src/cache.ts).
  const published = await runQuery(ctx, resolveQuery(ctx, body({ chart: PUBLISHED })).query, 'batch');
  const standard = await runQuery(ctx, resolveQuery(ctx, body({ chart: PUBLISHED })).query, 'standard');
  assert.deepEqual(published.cacheLookup.key, standard.cacheLookup.key);
});

test('a published chart and a query in one request is refused, not guessed', () => {
  // Which one did the caller believe would run? Serving either produces a number from a
  // query they did not mean.
  assert.throws(
    () => resolveQuery(ctx, body({ chart: PUBLISHED, query: AD_HOC_QUERY })),
    /not both/,
  );
});

test('a request naming nothing is refused', () => {
  assert.throws(() => resolveQuery(ctx, body({})), /published `chart` reference or an ad-hoc `query`/);
  // No route schema validates this body yet, so `null` and a bare string reach the
  // resolver. They get the sentence, not a TypeError with a property name in it.
  for (const junk of [null, 'operational', 42]) {
    assert.throws(() => resolveQuery(ctx, junk as unknown as QueryRequestBody), /ad-hoc `query`/);
  }
  assert.throws(() => resolveQuery(ctx, body({ chart: { dashboard: 'nightly_margin' } })), /must be \{ dashboard/);
});

test('a chart that is not in the published dashboard is refused', () => {
  assert.throws(
    () => resolveQuery(ctx, body({ chart: { dashboard: 'nightly_margin', id: 'invented' } })),
    /not in published dashboard/,
  );
});

test('a dashboard that is not published is refused, and cannot escape the tenant root', () => {
  assert.throws(() => resolveQuery(ctx, body({ chart: { dashboard: 'absent', id: 'x' } })), /not found/);
  assert.throws(
    () => resolveQuery(ctx, body({ chart: { dashboard: '../../../etc/passwd', id: 'x' } })),
    /invalid dashboard name/,
  );
});

test('POST /v1/queries executes the PUBLISHED query and reports the published class', async () => {
  const res = await app.inject({ method: 'POST', url: '/v1/queries', payload: { chart: PUBLISHED } });
  assert.equal(res.statusCode, 200);
  const env = res.json() as { meta: { freshness: { class: string; max_staleness_seconds: number } } };
  assert.equal(env.meta.freshness.class, PUBLISHED_CLASS);
  // What the engine was actually asked for, which is the one observation in this file
  // that no amount of correct-looking envelope can fake.
  assert.deepEqual(lastEngineQuery?.['measures'], ['sales.margin']);
});

test('POST /v1/queries ignores a body freshness end to end', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/queries',
    payload: { query: AD_HOC_QUERY, freshness: 'operational' },
  });
  assert.equal(res.statusCode, 200);
  const env = res.json() as { meta: { freshness: { class: string; max_staleness_seconds: number } } };
  assert.equal(env.meta.freshness.class, 'standard');
  // The staleness the response PROMISES the reader (FR-FRESH-03) is the standard class's
  // 30 minutes, not operational's 60 seconds. A response that promised 60s while being
  // served under a 30-minute policy is a stale number wearing a fresh label.
  assert.equal(env.meta.freshness.max_staleness_seconds, 30 * 60);
  // The ad-hoc path still works unchanged: the CLI, curl and
  // scripts/verify-walking-skeleton.sh all post a bare `query` and must keep working.
  assert.deepEqual(lastEngineQuery?.['measures'], ['sales.revenue']);
});

test('POST /v1/queries refuses a reference to an artifact that is not published', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/queries',
    payload: { chart: { dashboard: 'nightly_margin', id: 'invented' } },
  });
  assert.equal(res.statusCode, 400);
  assert.match((res.json() as { data: { error: string } }).data.error, /not in published dashboard/);
});
