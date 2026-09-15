/**
 * The degradation vocabulary, shared by everything that produces or renders one.
 *
 * ADR-006's 2026-09-14 amendment defines `meta.notices` and gives it three rules. The
 * second one -- "`packages/charts` takes `notices` as an input, because if only the
 * browser degrades, the CI screenshot attached to a PR is a *cleaner* picture than the
 * user's" -- needs a type that the producer (`apps/api`) and the adapter
 * (`packages/charts`) can both name. It lived in `apps/api/src/envelope.ts`, which
 * `packages/charts` must not import, so the adapter had no way to hold one.
 *
 * It lands here rather than being copied into the adapter for the reason
 * `apps/api/src/envelope.ts` already states about `CacheOutcome` and `FreshnessClass`:
 * two definitions of one closed enum typecheck fine and drift silently, and a renderer
 * that switches on a code the producer has since renamed fails by rendering nothing --
 * which is the exact failure mode the notices channel exists to remove.
 *
 * `packages/spec` is the shared vocabulary package; it already holds the freshness
 * classes and the runtime policy they map to for the same reason.
 */

/**
 * A closed enum, per ADR-006: the renderer switches on the code, and an open string
 * field becomes prose that nothing renders. Adding a code is a deliberate schema change.
 *
 * `query_failed` is the one added by TW-156 (FR-VIZ-13). The amendment's list covers
 * degraded results -- it has no code for the case where there is no result at all,
 * which is the state a chart is in when its query throws. Without it, a failure could
 * only be communicated by HTTP status, and the amendment's first rule forbids exactly
 * that ("nothing is communicated by an HTTP status alone").
 */
export type NoticeCode =
  | 'row_limit_reached'
  | 'served_stale'
  | 'partial_failure'
  | 'empty_by_policy'
  | 'query_timeout'
  | 'query_failed'
  | 'cache_degraded';

export type NoticeSeverity = 'info' | 'warn' | 'error';

export interface Notice {
  code: NoticeCode;
  severity: NoticeSeverity;
  /**
   * Plain language, for a person looking at a chart. Not an error code, not an HTTP
   * status, and never an engine or database message: those name a vendor, sometimes
   * quote the SQL, and tell the reader nothing they can act on (FR-VIZ-13, NFR-SEC-05).
   * The producer is responsible for the translation, because it is the only side that
   * knows what actually happened and the only side allowed to log the raw detail.
   */
  message: string;
}

/**
 * Types only, and deliberately so: `@tailwind/spec`'s barrel reaches `node:fs` to load
 * the JSON schemas, so a browser bundle may import a TYPE from this package -- which
 * erases -- but not a value, which drags Node's filesystem into `apps/web` and fails
 * the Vite build. The predicate for "which notices must be rendered" therefore lives in
 * `packages/charts`, next to the surfaces that answer to it. Found the hard way; the
 * build error blames `schemas.ts` and says nothing about the import that pulled it in.
 */
