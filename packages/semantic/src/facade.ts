import {
  isFreshnessClass,
  type ChartQuery,
  type FreshnessClass,
  type TimeDimensionRef,
} from '@tailwind/spec';
import { cubeLoad, cubeSql, type EngineResultSet } from './cube-client.ts';
import { bundleVersion } from './engine-config.ts';
import { cacheKeyFor, cacheLookupFor, type CacheLookup, type CacheOutcome } from './cache.ts';
import type { SecurityContext } from './security-context.ts';

export type TimeDimension = TimeDimensionRef;

/** A chart query is already a semantic query; the alias keeps the facade's vocabulary. */
export type SemanticQuery = ChartQuery;

export interface CompiledQuery {
  /** What we send to the engine. Exposed so a test can assert on it without a network hop. */
  engineQuery: Record<string, unknown>;
  /** Which view the query is scoped to -- dashboards may reference views only (FR-SEM-02). */
  view: string;
  /** The effective row limit: the author's, or the FR-ADM-03 cap, whichever is smaller. */
  rowLimit: number;
  /**
   * Whether dropped rows should be reported to the reader.
   *
   * False only for a deliberate ORDERED Top-N, where the excluded rows are the point.
   * True everywhere else -- including an author `limit` with no `order`, which looks
   * like a choice and behaves like an accident.
   */
  reportTruncation: boolean;
  /** What to ask the engine for: rowLimit, plus a probe row unless this is an ordered Top-N. */
  engineLimit: number;
}

/**
 * FR-ADM-03. The default result-set cap.
 *
 * Named rather than inline so the number appears once and a caller can report it in
 * the `row_limit_reached` notice instead of restating a magic constant.
 */
export const DEFAULT_ROW_LIMIT = 10000;

export interface QueryResult {
  rows: Record<string, unknown>[];
  sql: string;
  asOf: string | undefined;
  /**
   * True when the result hit the FR-ADM-03 cap and rows were dropped.
   *
   * The cap is deliberate; a cap you cannot detect is not. Without this, "revenue by
   * customer" silently becomes "revenue by the first 10,000 customers" and renders as
   * a complete chart -- a confident chart with a wrong number, which is the failure
   * this product exists to prevent.
   */
  truncated: boolean;
  /** The limit that was applied, so a caller can say what it was. */
  rowLimit: number;
  /**
   * The LIMIT actually sent to the engine -- `rowLimit`, or `rowLimit + 1` when a probe
   * row was requested.
   *
   * The audit record needs this. `sql` is deliberately rendered at `rowLimit` so the
   * FR-CON-02 panel describes the result the reader got, which means `sql` alone is not
   * a faithful account of what executed. Recording the number closes that gap without a
   * second round trip to the engine for a string differing by one character.
   */
  engineLimit: number;
  /**
   * The class this query actually EXECUTED under.
   *
   * Returned rather than left to the caller to remember, because the envelope's
   * `freshness.class` is a claim about how the number was produced. A caller that
   * labels the response from its own variable can drift from what the facade was
   * given; a caller that labels it from here cannot.
   */
  freshness: FreshnessClass;
  /** `bypass` until TW-44 installs a store -- honest, where `miss` would imply one. */
  cache: CacheOutcome;
  /**
   * The key this execution addressed and the policy it ran under, exposed so a test
   * can assert on cache identity without a store existing (and so T-117's two-user
   * check can assert two contexts produce two keys).
   */
  cacheLookup: CacheLookup;
}

/**
 * Translate a Tailwind chart query into the engine's request shape.
 *
 * The security context is a REQUIRED parameter with no overload that omits it
 * (ADR-003 D4, FR-SEM-14). In the POC it resolves permissively, but the parameter,
 * the plumbing and the cache-key component exist from commit one -- retrofitting a
 * security dimension into the compiler and the cache is a rewrite of both.
 */
export function compile(query: SemanticQuery, ctx: SecurityContext): CompiledQuery {
  // Defence in depth. The branded type stops TypeScript callers, but the AI path and
  // any dynamic caller reach this from plain JS, and FR-SEM-14 says a request with no
  // resolved tenant is rejected rather than served -- so it is checked, not assumed.
  if (typeof ctx?.tenant !== 'string' || ctx.tenant === '') {
    throw new Error('compile() requires a resolved SecurityContext (FR-SEM-14)');
  }

  // Every member must be view-qualified and must match the query's view. This is
  // the runtime half of FR-SEM-02: cubes are private, so a chart cannot reach past
  // the certified surface into a raw cube.
  const members = [
    ...query.metrics,
    ...(query.dimensions ?? []),
    ...(query.time_dimensions ?? []).map((t) => t.member),
    ...(query.filters ?? []).map((f) => f.member),
    ...(query.order ?? []).map((o) => o.member),
  ];
  for (const m of members) {
    const view = m.split('.')[0];
    if (view !== query.view) {
      throw new Error(`member '${m}' is outside view '${query.view}'; dashboards may reference views only (FR-SEM-02)`);
    }
  }

  const engineQuery: Record<string, unknown> = {
    measures: query.metrics,
    dimensions: query.dimensions ?? [],
  };
  if (query.time_dimensions?.length) {
    engineQuery['timeDimensions'] = query.time_dimensions.map((t) => ({
      dimension: t.member,
      granularity: t.granularity,
    }));
  }
  if (query.filters?.length) {
    engineQuery['filters'] = query.filters.map((f) => ({
      member: f.member,
      operator: f.operator,
      values: f.values,
    }));
  }
  if (query.order?.length) {
    engineQuery['order'] = query.order.map((o) => [o.member, o.dir]);
  }
  // FR-ADM-03: a result-set cap exists from the first query rather than being added
  // after something falls over.
  const asked = query.limit ?? DEFAULT_ROW_LIMIT;
  const rowLimit = Math.min(asked, DEFAULT_ROW_LIMIT);

  // Whether dropping rows is something the author CHOSE or something that happened TO
  // them. The difference is the `order`, not the number.
  //
  // "Top 10 products" is `limit: 10` WITH an order: the author picked the ten they
  // meant and the other rows are not missing, they are excluded. Warning there puts a
  // caveat on a chart that is behaving exactly as designed, every time it loads, which
  // teaches people to ignore the channel.
  //
  // `limit: 500` with NO order is a different thing wearing the same clothes: the
  // engine returns whichever 500 rows it happens to reach first, and the author almost
  // certainly believed that was all of them. That is the silent truncation this whole
  // mechanism exists to catch, and the previous rule -- probe only when the cap binds
  // -- missed every case of it below 10,000 rows.
  const orderedTopN = (query.order?.length ?? 0) > 0 && asked < DEFAULT_ROW_LIMIT;
  // Ask for ONE row more than we will return, so that dropping rows is detectable. A
  // cap you cannot detect is not a cap, it is a quiet lie. The only query we do not
  // probe is a deliberate ordered Top-N, where there is nothing to say.
  engineQuery['limit'] = orderedTopN ? rowLimit : rowLimit + 1;

  // The context is not yet a predicate source in the POC (the pilot area has no row
  // differences), but it is threaded here so the seam is real. Tenant is carried into
  // the engine as a JWT claim by the client.
  void ctx;

  return {
    engineQuery,
    view: query.view,
    rowLimit,
    reportTruncation: !orderedTopN,
    engineLimit: engineQuery['limit'] as number,
  };
}

/**
 * Drop the probe row and say whether the cap bit.
 *
 * Pure and exported so the decision is testable without a network hop -- the bug this
 * guards against is a silent regression to `truncated: false`, which no integration
 * test would notice because the chart still renders.
 */
export function applyRowLimit(
  data: Record<string, unknown>[],
  rowLimit: number,
  reportTruncation: boolean,
): { rows: Record<string, unknown>[]; truncated: boolean } {
  // Slice regardless -- the probe row is never data. Only the REPORTING is conditional.
  const truncated = reportTruncation && data.length > rowLimit;
  return { rows: data.length > rowLimit ? data.slice(0, rowLimit) : data, truncated };
}

export interface PreparedQuery {
  compiled: CompiledQuery;
  cacheLookup: CacheLookup;
}

/**
 * Everything decided before a byte leaves the process: what the engine will be asked,
 * and under what identity and policy the answer may be reused.
 *
 * Split out of `runQuery` for two reasons. A cache must be able to compute its key
 * *before* deciding to execute, so this is the half TW-44 calls first. And it makes the
 * property this ticket exists to guarantee testable without a warehouse: the assertion
 * that a `batch` and a `standard` request address the same entry runs against the real
 * derivation rather than a copy of it in a test.
 */
export function prepareQuery(
  ctx: SecurityContext,
  query: SemanticQuery,
  freshness: FreshnessClass,
): PreparedQuery {
  // Defence in depth, exactly as `compile` does for the context: the branded union
  // stops TypeScript callers, but the AI path and a request body arrive as plain
  // strings. A class we do not recognise is refused rather than quietly mapped onto
  // `standard` -- guessing a cache policy is how an `operational` chart gets served
  // 24-hour-old numbers with nothing in the response admitting it.
  if (!isFreshnessClass(freshness)) {
    throw new Error(`a query requires a FreshnessClass, got '${String(freshness)}' (FR-FRESH-02)`);
  }
  const compiled = compile(query, ctx);
  // The cache seam. The store is TW-44 and its topology is ADR-008; what exists now is
  // the address (key) and the acceptance rule (policy), computed on every query so the
  // day a store is installed it is wired to something already exercised rather than to
  // a shape invented at that moment. The class is in the policy and nowhere near the
  // key -- cache.ts says why that matters in both directions.
  const key = cacheKeyFor(ctx, compiled.engineQuery, bundleVersion());
  return { compiled, cacheLookup: cacheLookupFor(key, freshness) };
}

/**
 * Compile, then execute. The only path from a spec to a number (binding constraint 2).
 *
 * ADR-006 D4's signature: `(ctx, query, freshness)`, three required parameters and no
 * overload that omits any of them. Both of the governed inputs are positional and
 * neither has a default, for the same reason:
 *
 * - **`ctx`** decides which ROWS the request may see (FR-SEM-14/15). Resolved per
 *   request from the requesting user, never from the artifact's author.
 * - **`freshness`** decides how OLD an answer may be (FR-FRESH-02). It is what the
 *   cache reads its policy from -- so while it was only carried on the response, it was
 *   a label on a number rather than an input to producing one, and ADR-008 would have
 *   been written for a cache whose only caller could not tell it what policy to apply.
 *   That is the defect this signature fixes.
 *
 * The class is a *governed* property of a reviewed spec, so a default here would be the
 * same mistake in a quieter form: the caller that forgets gets `standard` and nobody
 * finds out. Resolving it from the published artifact rather than the request body is
 * TW-167, and `apps/api` still reads it from the body until that lands.
 *
 * Note what is NOT a parameter: transport options. The facade owns its own engine
 * configuration (`engine-config.ts`), so no route module handles the engine's
 * credentials and no caller can point one call at a different warehouse.
 */
export async function runQuery(
  ctx: SecurityContext,
  query: SemanticQuery,
  freshness: FreshnessClass,
): Promise<QueryResult> {
  const { compiled, cacheLookup } = prepareQuery(ctx, query, freshness);
  const { engineQuery, rowLimit, reportTruncation, engineLimit } = compiled;
  // The SQL shown to a user must describe the result they actually got. The probe row
  // is our business, not theirs: showing `LIMIT 10001` above 10,000 rows in the
  // "how is this calculated?" panel (FR-CON-02) undermines the one surface whose whole
  // job is to be trusted. The audit record is the other half of that trade -- it needs
  // what EXECUTED, so it takes `engineLimit` alongside this string (migration 003).
  const shownQuery = { ...engineQuery, limit: rowLimit };
  const [result, sql]: [EngineResultSet, string] = await Promise.all([
    cubeLoad(engineQuery, ctx),
    cubeSql(shownQuery, ctx).catch(() => ''),
  ]);
  return {
    ...applyRowLimit(result.data, rowLimit, reportTruncation),
    sql,
    asOf: result.lastRefreshTime,
    rowLimit,
    engineLimit,
    freshness,
    // `bypass`, not `miss`: a miss says a store looked and found nothing, which implies
    // it then filled. No store exists, and claiming a miss would make TW-44's first
    // hit-rate measurement read as an improvement over a number that was never real.
    cache: 'bypass',
    cacheLookup,
  };
}
