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
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  sql: string;
  asOf: string | undefined;
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
  engineQuery['limit'] = query.limit ?? 10000;

  // The context is not yet a predicate source in the POC (the pilot area has no row
  // differences), but it is threaded here so the seam is real. Tenant is carried into
  // the engine as a JWT claim by the client.
  void ctx;

  return { engineQuery, view: query.view };
}

/** Compile, then execute. The only path from a spec to a number. */
export async function runQuery(
  opts: CubeClientOptions,
  query: SemanticQuery,
  ctx: SecurityContext,
): Promise<QueryResult> {
  const { engineQuery } = compile(query, ctx);
  const [result, sql]: [CubeResultSet, string] = await Promise.all([
    cubeLoad(opts, engineQuery, ctx),
    // FR-CON-02: the generated SQL is always available, so "how is this calculated?"
    // is answerable for every chart rather than being a debugging affordance.
    cubeSql(opts, engineQuery, ctx).catch(() => ''),
  ]);
  return { rows: result.data, sql, asOf: result.lastRefreshTime };
}
