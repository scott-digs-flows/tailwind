import type { FreshnessClass } from './types.ts';

/**
 * FR-FRESH-02. The freshness CLASS drives cache behaviour; authors never configure
 * caching directly. This function is the single place that mapping lives, so ADR-008's
 * cache reads a policy rather than re-deciding what `standard` means.
 */
export interface CachePolicy {
  class: FreshnessClass;
  /** 0 means bypass the cache entirely. */
  ttlSeconds: number;
  /** Populate after an upstream refresh rather than on first request. */
  prewarm: boolean;
  /** Invalidate when the upstream signals a refresh (FR-FRESH-05: dbt run completion). */
  invalidateOnUpstreamRefresh: boolean;
  /** The staleness the class PROMISES. Used to decide `stale`, and to detect drift. */
  maxStalenessSeconds: number;
}

const POLICIES: Record<FreshnessClass, CachePolicy> = {
  batch: {
    class: 'batch',
    ttlSeconds: 24 * 60 * 60,
    prewarm: true,
    invalidateOnUpstreamRefresh: true,
    maxStalenessSeconds: 24 * 60 * 60,
  },
  standard: {
    class: 'standard',
    ttlSeconds: 30 * 60,
    prewarm: false,
    invalidateOnUpstreamRefresh: true,
    maxStalenessSeconds: 30 * 60,
  },
  operational: {
    // Near-live, so there is no meaningful result cache. NFR-SCALE-03's hit-rate target
    // does not apply to this class, and a blended target across classes is meaningless.
    class: 'operational',
    ttlSeconds: 0,
    prewarm: false,
    invalidateOnUpstreamRefresh: false,
    maxStalenessSeconds: 60,
  },
};

export const DEFAULT_FRESHNESS: FreshnessClass = 'standard';

export function cachePolicyFor(cls: FreshnessClass = DEFAULT_FRESHNESS): CachePolicy {
  return POLICIES[cls] ?? POLICIES[DEFAULT_FRESHNESS];
}

/**
 * Where the as-of timestamp came from.
 *
 * `unknown` is a real, common answer and it must not be dressed up. Reporting the
 * REQUEST time as the data's as-of claims the numbers are as fresh as the page load,
 * which is the most confidently wrong thing a BI tool can say. FR-FRESH-05's real
 * signal is upstream refresh completion, which arrives with T-111.
 */
export type AsOfSource = 'engine' | 'unknown';

export interface FreshnessReport {
  class: FreshnessClass;
  /** null when the data's as-of is genuinely unknown -- never the request time. */
  asOf: string | null;
  asOfSource: AsOfSource;
  /** null when unknowable: absence of information is not evidence of freshness. */
  stale: boolean | null;
  maxStalenessSeconds: number;
}

export function freshnessReport(
  cls: FreshnessClass | undefined,
  engineAsOf: string | undefined,
  now: Date = new Date(),
): FreshnessReport {
  const policy = cachePolicyFor(cls);
  if (engineAsOf === undefined) {
    return {
      class: policy.class,
      asOf: null,
      asOfSource: 'unknown',
      stale: null,
      maxStalenessSeconds: policy.maxStalenessSeconds,
    };
  }
  const ageSeconds = (now.getTime() - new Date(engineAsOf).getTime()) / 1000;
  return {
    class: policy.class,
    asOf: engineAsOf,
    asOfSource: 'engine',
    stale: ageSeconds > policy.maxStalenessSeconds,
    maxStalenessSeconds: policy.maxStalenessSeconds,
  };
}
