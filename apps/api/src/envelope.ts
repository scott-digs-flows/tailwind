import type { SecurityContext } from '@tailwind/semantic';
import { securityContextDigest } from '@tailwind/semantic';
import { freshnessReport } from '@tailwind/spec';

/** FR-FRESH-01. Declared per artifact; only `standard` needs to work in the POC. */
export type FreshnessClass = 'batch' | 'standard' | 'operational';
export type CacheOutcome = 'hit' | 'miss' | 'bypass';

/**
 * ADR-006 D3. These fields are not decoration:
 *   as_of + freshness      -> FR-CON-03, FR-FRESH-03
 *   bundle_version         -> what makes rollback observable (FR-GOV-08)
 *   security_context_digest-> proves which context produced this result
 *   trace_id               -> NFR-OPS-01
 * Adding them later means touching every endpoint and every call site.
 */
export interface EnvelopeMeta {
  bundle_version: string;
  /**
   * The DATA's as-of, or null when genuinely unknown. Never the request time:
   * claiming the numbers are as fresh as the page load is the most confidently wrong
   * thing a BI tool can say (FR-FRESH-03).
   */
  as_of: string | null;
  freshness: {
    class: FreshnessClass;
    /** null when unknowable -- absence of information is not evidence of freshness. */
    stale: boolean | null;
    as_of_source: 'engine' | 'unknown';
    max_staleness_seconds: number;
  };
  cache: CacheOutcome;
  trace_id: string;
  security_context_digest: string;
}

export interface Envelope<T> {
  meta: EnvelopeMeta;
  data: T;
}

export const BUNDLE_VERSION = process.env['TAILWIND_BUNDLE_VERSION'] ?? 'dev';

/**
 * The security context is a REQUIRED positional parameter with no overload that
 * omits it (ADR-006 D4). If you find yourself wanting one, that is the smell
 * FR-SEM-14 exists to catch.
 */
export function envelope<T>(
  data: T,
  ctx: SecurityContext,
  opts: {
    traceId: string;
    freshnessClass?: FreshnessClass;
    stale?: boolean;
    cache?: CacheOutcome;
    asOf?: string;
  },
): Envelope<T> {
  // One derivation, shared by every endpoint (FR-FRESH-02/03).
  const f = freshnessReport(opts.freshnessClass, opts.asOf);
  return {
    meta: {
      bundle_version: BUNDLE_VERSION,
      as_of: f.asOf,
      freshness: {
        class: f.class,
        stale: opts.stale ?? f.stale,
        as_of_source: f.asOfSource,
        max_staleness_seconds: f.maxStalenessSeconds,
      },
      cache: opts.cache ?? 'bypass',
      trace_id: opts.traceId,
      security_context_digest: securityContextDigest(ctx),
    },
    data,
  };
}
