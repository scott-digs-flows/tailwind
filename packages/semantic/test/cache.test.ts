import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheKeyFor,
  cacheKeyString,
  cacheLookupFor,
  prepareQuery,
  pocSystemContext,
  resolveSecurityContext,
  type CachedResult,
  type CacheLookup,
  type ResultCache,
  type SemanticQuery,
} from '../src/index.ts';

const ctx = pocSystemContext();
const query: SemanticQuery = {
  view: 'sales',
  metrics: ['sales.revenue'],
  dimensions: ['sales.region'],
};

/**
 * The smallest thing that can be called a cache: a Map addressed by the key string,
 * with the policy consulted only after the entry is found.
 *
 * It lives in the test rather than in `src` on purpose -- the store is TW-44 and
 * ADR-008 decides its topology. What is asserted here is the API's shape, and this
 * fake is the proof that the shape supports the behaviour the shape was chosen for.
 */
function fakeCache(): ResultCache & { size: () => number } {
  const entries = new Map<string, CachedResult>();
  return {
    size: () => entries.size,
    get: async (lookup: CacheLookup) => {
      const hit = entries.get(cacheKeyString(lookup.key));
      if (hit === undefined) return undefined;
      // Addressed by the KEY; accepted or rejected by the POLICY. This ordering is the
      // whole separation: an entry a `standard` request wrote is found by a `batch`
      // request, and only then judged against the batch budget.
      const ageSeconds = (Date.now() - Date.parse(hit.storedAt)) / 1000;
      return ageSeconds <= lookup.policy.ttlSeconds ? hit : undefined;
    },
    set: async (lookup: CacheLookup, value: CachedResult) => {
      if (lookup.policy.ttlSeconds === 0) return; // `operational` does not cache at all.
      entries.set(cacheKeyString(lookup.key), value);
    },
  };
}

const stored = (): CachedResult => ({
  rows: [{ 'sales.region': 'Europe', 'sales.revenue': 1 }],
  sql: 'SELECT 1',
  asOf: undefined,
  truncated: false,
  rowLimit: 10,
  storedAt: new Date().toISOString(),
});

test('two freshness classes over one query share one cache entry (FR-FRESH-02)', async () => {
  // The acceptance criterion, and the reason the class is kept out of the key. Keyed by
  // class, this Map would hold two entries: two warehouse queries and two invalidation
  // lifetimes for one set of numbers, at identical security. The hit rate halves and
  // nothing is bought with it.
  const cache = fakeCache();
  const batch = prepareQuery(ctx, query, 'batch');
  const standard = prepareQuery(ctx, query, 'standard');

  assert.equal(
    cacheKeyString(batch.cacheLookup.key),
    cacheKeyString(standard.cacheLookup.key),
    'the freshness class must not change the cache key',
  );

  await cache.set(batch.cacheLookup, stored());
  const hit = await cache.get(standard.cacheLookup);

  assert.ok(hit !== undefined, 'a standard request must be answerable from a batch entry');
  assert.equal(cache.size(), 1, 'one query, one entry, however many classes ask for it');

  // The policies still differ -- separation, not conflation. If these were equal the
  // test above would be passing because the class had been dropped everywhere, which is
  // the negative control: a class that changes nothing is not being applied at all.
  assert.equal(batch.cacheLookup.policy.class, 'batch');
  assert.equal(standard.cacheLookup.policy.class, 'standard');
  assert.notEqual(batch.cacheLookup.policy.ttlSeconds, standard.cacheLookup.policy.ttlSeconds);
});

test('the policy, not the key, is what refuses a stale entry', async () => {
  const cache = fakeCache();
  const batch = prepareQuery(ctx, query, 'batch');
  const operational = prepareQuery(ctx, query, 'operational');

  // Written 10 minutes ago: inside batch's 24 h budget, far outside operational's 60 s.
  await cache.set(batch.cacheLookup, { ...stored(), storedAt: new Date(Date.now() - 600_000).toISOString() });

  assert.ok(await cache.get(batch.cacheLookup), 'batch may serve a 10-minute-old answer');
  assert.equal(
    await cache.get(operational.cacheLookup),
    undefined,
    'operational may not -- and it refuses on the POLICY, having found the same entry',
  );
  // Same entry, so the refusal above cannot have been a key miss.
  assert.equal(cacheKeyString(batch.cacheLookup.key), cacheKeyString(operational.cacheLookup.key));
});

test('the key has exactly four components (ADR-008)', () => {
  const key = cacheKeyFor(ctx, { measures: ['sales.revenue'] }, 'bundle-1');
  assert.deepEqual(Object.keys(key).sort(), [
    'bundleVersion',
    'queryHash',
    'securityContextDigest',
    'tenant',
  ]);
});

test('the security context IS in the key -- two users, two entries (FR-SEM-15)', async () => {
  // The other direction, and the one that leaks rather than costs. This is the single
  // most repeated bug in the category: something scopes the query and fails to scope
  // the cache.
  const cache = fakeCache();
  const morgan = resolveSecurityContext({ tenant: 'internal', subject: 'morgan', groups: ['analyst'] });
  const wes = resolveSecurityContext({ tenant: 'internal', subject: 'wes', groups: ['europe_only'] });

  const a = prepareQuery(morgan, query, 'standard');
  const b = prepareQuery(wes, query, 'standard');
  assert.notEqual(cacheKeyString(a.cacheLookup.key), cacheKeyString(b.cacheLookup.key));

  await cache.set(a.cacheLookup, stored());
  assert.equal(await cache.get(b.cacheLookup), undefined, "one user's rows must not answer another's request");
  assert.equal(cache.size(), 1);
});

test('a different bundle version is a different entry (FR-GOV-08)', () => {
  const engineQuery = { measures: ['sales.revenue'] };
  assert.notEqual(
    cacheKeyString(cacheKeyFor(ctx, engineQuery, 'bundle-1')),
    cacheKeyString(cacheKeyFor(ctx, engineQuery, 'bundle-2')),
  );
  // Otherwise a rollback is observable in the envelope and inert in the numbers.
});

test('the query hash is stable under key order and sensitive to sequence', () => {
  const a = cacheKeyFor(ctx, { measures: ['sales.revenue'], dimensions: ['sales.region'] }, 'dev');
  const b = cacheKeyFor(ctx, { dimensions: ['sales.region'], measures: ['sales.revenue'] }, 'dev');
  assert.equal(a.queryHash, b.queryHash, 'object key order is not a difference in the query');

  // Arrays are sequences in an engine query -- `order` and `dimensions` mean different
  // results in different orders, so they must not be normalised away.
  const c = cacheKeyFor(ctx, { dimensions: ['sales.region', 'sales.category'] }, 'dev');
  const d = cacheKeyFor(ctx, { dimensions: ['sales.category', 'sales.region'] }, 'dev');
  assert.notEqual(c.queryHash, d.queryHash);

  // The row cap is inside the hash: a result truncated at 10,000 rows must not be
  // served to a request that asked for 100.
  assert.notEqual(
    cacheKeyFor(ctx, { measures: ['sales.revenue'], limit: 100 }, 'dev').queryHash,
    cacheKeyFor(ctx, { measures: ['sales.revenue'], limit: 10001 }, 'dev').queryHash,
  );
});

test('the freshness class cannot be put in the key, and a key cannot be forged', () => {
  // Type level: `cacheKeyFor` does not take the class, so no implementation of it can
  // key on the class however a caller is written. If someone adds the parameter, this
  // stops erroring and the @ts-expect-error becomes the failure.
  // @ts-expect-error -- there is deliberately no freshness parameter on the key builder.
  const _keyGuard = () => cacheKeyFor(ctx, { measures: [] }, 'dev', 'batch');
  void _keyGuard;

  // And the key is branded, so it cannot be assembled by an object literal that quietly
  // carries a fifth component.
  // @ts-expect-error -- CacheKey is branded; cacheKeyFor is the only way to build one.
  const _forge = (): void => void cacheKeyString({
    tenant: 'internal',
    securityContextDigest: 'x',
    bundleVersion: 'dev',
    queryHash: 'y',
  });
  void _forge;

  // Run time: a context is required here as it is everywhere else (FR-SEM-14).
  assert.throws(
    // @ts-expect-error -- deliberately bypassing the type to exercise the guard.
    () => cacheKeyFor(undefined, { measures: [] }, 'dev'),
    /requires a resolved SecurityContext/,
  );
});

test('an unknown upstream watermark is null, not a guess (FR-FRESH-05)', () => {
  const lookup = cacheLookupFor(cacheKeyFor(ctx, { measures: [] }, 'dev'), 'standard');
  assert.equal(lookup.upstreamWatermark, null);
  assert.equal(lookup.policy.invalidateOnUpstreamRefresh, true);
  // T-111 supplies the signal. Until then `standard` has only its TTL, and saying so is
  // what keeps the gap visible instead of papered over.
});
