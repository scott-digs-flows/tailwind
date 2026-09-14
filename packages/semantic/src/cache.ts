import { createHash } from 'node:crypto';
import { cachePolicyFor, type CachePolicy, type FreshnessClass } from '@tailwind/spec';
import { securityContextDigest, type SecurityContext } from './security-context.ts';

/**
 * The cache API's SHAPE, with no cache behind it yet.
 *
 * The store itself is TW-44 and the topology is ADR-008; neither is built here. What is
 * built here is the distinction those two have to be written against, because
 * `02-architecture-brief.md section 3.3b` says the freshness class must be an input to
 * the cache layer "from the first version" and cache APIs are painful to re-cut. The
 * distinction is:
 *
 *   KEY    = (tenant, security_context_digest, bundle_version, query_hash)
 *            -- WHAT was asked for, and by whom. Identity.
 *   POLICY = (freshness_class, upstream_watermark)
 *            -- HOW old an answer may be before it stops counting. Acceptance.
 *
 * Two entries with the same key hold the same bytes; the policy decides whether those
 * bytes are still good enough for *this* request. Collapsing the two is the mistake
 * this file exists to make unavailable, and it is easy to make: the class is already on
 * the request, the key is already a tuple, and adding one more component to a tuple
 * looks harmless.
 *
 * It is not harmless in either direction.
 *
 * - **Class in the key halves the hit rate for nothing.** A `batch` and a `standard`
 *   view of the same metric for the same user under the same bundle are the same
 *   numbers. Keyed by class they become two entries, two warehouse queries and two
 *   invalidation lifetimes, and the security posture is identical -- so it is pure
 *   cost. NFR-SCALE-03's per-class hit-rate targets are unreachable by construction if
 *   the classes cannot share what they compute.
 * - **Security context out of the key leaks rows.** That is the other half, and it is
 *   the single most repeated bug in this product category (Metabase CVE-2025-27141;
 *   the dbt Semantic Layer's documented cache/RLS gap; Cube's own warning about
 *   pre-aggregations refreshed without a context). The default is per-context keying.
 *   Pre-RLS caching is an optimisation that must prove all four of the architecture
 *   brief's section 3.3 conditions, per query shape, in ADR-008 -- not here.
 *
 * So `CacheKey` is branded and `cacheKeyFor` is the only way to build one, and
 * `cacheKeyFor` **cannot see the freshness class**: it is not a parameter, so no
 * implementation of it can put the class in the key however the caller is written.
 */

declare const KEY_BRAND: unique symbol;

/**
 * The four components, and there is no fifth.
 *
 * `tenant` is carried alongside `securityContextDigest` even though the digest already
 * covers it, because the digest is opaque: an operator evicting one tenant after a
 * model change, or an ADR-014 backstop asserting that a key belongs to the tenant that
 * asked, needs the tenant readable rather than hashed.
 */
export interface CacheKey {
  readonly [KEY_BRAND]: true;
  readonly tenant: string;
  readonly securityContextDigest: string;
  readonly bundleVersion: string;
  readonly queryHash: string;
}

/** Deterministic JSON: object keys sorted at every depth, so key order in the compiled
 *  query cannot produce two hashes for one query. Arrays keep their order -- in an
 *  engine query `order` and `dimensions` are sequences, and sorting them would fuse two
 *  genuinely different results into one entry. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * Build the key for one execution.
 *
 * `engineQuery` is the COMPILED query, not the author's chart query: it is what the
 * warehouse will actually run, so two chart queries that compile to the same request
 * are the same cached result and should share one entry. It also means the row cap is
 * inside the hash, which is right -- a result truncated at 10,000 rows must not be
 * served to a request that asked for 100.
 *
 * The security context is a required parameter with no overload that omits it
 * (ADR-006 D4, FR-SEM-14). The freshness class is deliberately absent; see the note at
 * the top of this file.
 */
export function cacheKeyFor(
  ctx: SecurityContext,
  engineQuery: Record<string, unknown>,
  bundleVersion: string,
): CacheKey {
  if (typeof ctx?.tenant !== 'string' || ctx.tenant === '') {
    throw new Error('cacheKeyFor() requires a resolved SecurityContext (FR-SEM-14)');
  }
  return Object.freeze({
    tenant: ctx.tenant,
    securityContextDigest: securityContextDigest(ctx),
    bundleVersion,
    queryHash: createHash('sha256').update(stableStringify(engineQuery)).digest('hex').slice(0, 32),
  }) as unknown as CacheKey;
}

/** The key as one string, for a store that takes flat keys. Ordered coarse to fine so a
 *  prefix scan can evict a tenant, then a context, then a bundle. */
export function cacheKeyString(key: CacheKey): string {
  return `tw:${key.tenant}:${key.securityContextDigest}:${key.bundleVersion}:${key.queryHash}`;
}

/**
 * Key plus policy: everything a store needs to answer one request, with the two halves
 * still separable.
 *
 * A store implementing this addresses its entry by `key` alone and then decides, from
 * `policy`, whether what it found may be served. That ordering is the whole point --
 * it is what lets a `batch` request be answered from an entry a `standard` request
 * wrote, and it is why `get` takes the lookup rather than the key.
 */
export interface CacheLookup {
  readonly key: CacheKey;
  /** Derived from the freshness class (FR-FRESH-02) in one place: `packages/spec`. */
  readonly policy: CachePolicy;
  /**
   * The upstream refresh this answer must be at least as new as (FR-FRESH-05). `null`
   * when unknown, which is every request today -- the dbt-run-completion signal lands
   * with T-111. Null means "the TTL is all you have", not "anything will do".
   */
  readonly upstreamWatermark: string | null;
}

export function cacheLookupFor(
  key: CacheKey,
  freshness: FreshnessClass,
  upstreamWatermark: string | null = null,
): CacheLookup {
  return Object.freeze({ key, policy: cachePolicyFor(freshness), upstreamWatermark });
}

/** What the envelope reports (ADR-006 D3). `bypass` covers both "policy says do not
 *  cache" and "no store is installed"; the two are distinguishable from the policy. */
export type CacheOutcome = 'hit' | 'miss' | 'bypass';

/** A stored result. `asOf` travels WITH the rows: a served entry still has to report
 *  the data's real as-of (FR-FRESH-03), and a cache that keeps only the rows would have
 *  to invent one, which is the fabricated timestamp ADR-006's D3 amendment removed. */
export interface CachedResult {
  readonly rows: Record<string, unknown>[];
  readonly sql: string;
  readonly asOf: string | undefined;
  readonly truncated: boolean;
  readonly rowLimit: number;
  /** When this entry was written, for TTL arithmetic. Never reported as the data's as-of. */
  readonly storedAt: string;
}

/**
 * The seam. TW-44 implements this; nothing here does.
 *
 * Stated as an interface now because the signatures are the part that is expensive to
 * change later, and they already encode the two rules ADR-008 must not break: every
 * operation is addressed by a `CacheKey` that cannot contain the freshness class, and
 * every operation is qualified by a policy the caller did not invent.
 */
export interface ResultCache {
  get(lookup: CacheLookup): Promise<CachedResult | undefined>;
  set(lookup: CacheLookup, value: CachedResult): Promise<void>;
}
