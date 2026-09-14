import type { ChartQuery, TimeDimensionRef } from '@tailwind/spec';
import { cubeLoad, cubeSql, type CubeClientOptions, type CubeResultSet } from './cube-client.ts';
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
   * True when the FR-ADM-03 cap is the binding constraint rather than the author's own
   * `limit`.
   *
   * This distinction is the whole point. An author who writes `limit: 10` for a "Top 10
   * products" chart got exactly what they asked for -- telling them their result was
   * truncated would be a warning on a chart that is behaving correctly, every time it
   * loads. A warning that fires when nothing is wrong teaches people to ignore the
   * channel, which is worse than the silence it replaced.
   */
  capBinds: boolean;
  /** What to ask the engine for: rowLimit, plus a probe row when the cap binds. */
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
  const capBinds = asked >= DEFAULT_ROW_LIMIT;
  // Ask for ONE row more than the cap, so that hitting it is detectable -- a cap you
  // cannot detect is not a cap, it is a quiet lie. Only when the cap binds: probing an
  // author's deliberate `limit: 10` would buy a row we have nothing to say about.
  const engineLimit = capBinds ? rowLimit + 1 : rowLimit;
  engineQuery['limit'] = engineLimit;

  // The context is not yet a predicate source in the POC (the pilot area has no row
  // differences), but it is threaded here so the seam is real. Tenant is carried into
  // the engine as a JWT claim by the client.
  void ctx;

  return { engineQuery, view: query.view, rowLimit, capBinds, engineLimit };
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
  capBinds: boolean,
): { rows: Record<string, unknown>[]; truncated: boolean } {
  const truncated = capBinds && data.length > rowLimit;
  return { rows: truncated ? data.slice(0, rowLimit) : data, truncated };
}

/** Compile, then execute. The only path from a spec to a number. */
export async function runQuery(
  opts: CubeClientOptions,
  query: SemanticQuery,
  ctx: SecurityContext,
): Promise<QueryResult> {
  const { engineQuery, rowLimit, capBinds } = compile(query, ctx);
  // The SQL shown to a user must describe the result they actually got. The probe row
  // is our business, not theirs: showing `LIMIT 10001` above 10,000 rows in the
  // "how is this calculated?" panel (FR-CON-02) undermines the one surface whose whole
  // job is to be trusted -- and the same string is what lands in the audit record.
  const shownQuery = { ...engineQuery, limit: rowLimit };
  const [result, sql]: [CubeResultSet, string] = await Promise.all([
    cubeLoad(opts, engineQuery, ctx),
    cubeSql(opts, shownQuery, ctx).catch(() => ''),
  ]);
  return { ...applyRowLimit(result.data, rowLimit, capBinds), sql, asOf: result.lastRefreshTime, rowLimit };
}
