import { DEFAULT_FRESHNESS, type ChartQuery, type FreshnessClass } from '@tailwind/spec';
import type { SecurityContext } from '@tailwind/semantic';
import { loadChart, type PublishedChart, type PublishedChartRef } from './content.ts';

/**
 * What `POST /v1/queries` accepts, and the whole of it.
 *
 * Two mutually exclusive shapes, because they are two different governance stories:
 *
 *   { chart: { dashboard, id } }  -- a PUBLISHED chart. The server reads the query and
 *                                   its freshness class out of the reviewed artifact.
 *   { query: { ... } }            -- AD HOC: a draft, the CLI, or an M2 AI proposal not
 *                                   yet merged. The server chooses the class.
 *
 * Note what is NOT in this type: `freshness`. That is the point of TW-167 and it is
 * deliberately structural rather than a check. A request may still carry the field --
 * older clients do, and ignoring it is the ticket's acceptance criterion, not rejecting
 * it -- but nothing on this path has a parameter it could arrive through. It is the same
 * technique `cacheKeyFor` uses to keep the class out of the cache key: if the value is
 * not a parameter, no implementation can be written that reads it.
 */
export interface QueryRequestBody {
  chart?: { dashboard?: unknown; id?: unknown };
  query?: ChartQuery;
}

export interface GovernedQuery {
  /** From the published artifact when one was named; otherwise the caller's own. */
  query: ChartQuery;
  /** Resolved server-side, always. */
  freshness: FreshnessClass;
  /**
   * The dashboard that governs this execution, for the audit record (FR-SEC-07).
   * `undefined` for an ad-hoc query, which is a real distinction an auditor wants:
   * "who ran something we never reviewed" is a different question from "who looked at
   * the sales dashboard".
   */
  dashboard: string | undefined;
}

/**
 * The one place the executed freshness class is chosen.
 *
 * It takes the published artifact and NOTHING ELSE -- no request, no body, no options
 * bag -- which is what makes "a class in a request body is ignored" a property of the
 * signature instead of a promise in a comment. A caller asking for `operational` has
 * nowhere to put the value.
 *
 * Why it is governed rather than convenient: the class decides how old an answer may be
 * (FR-FRESH-02) and therefore what a cache may serve and how much warehouse the request
 * costs. `operational` is cache-bypass and near-live, and FR-FRESH-04 says promoting an
 * artifact to it needs data-team approval *regardless of author role*. An API that takes
 * the class from whoever is calling hands out that approval to anyone who can write a
 * JSON body -- and does it invisibly, because the response then reports the class it was
 * handed and everything looks consistent.
 *
 * The ad-hoc default is `standard` (`packages/spec`'s DEFAULT_FRESHNESS), the same value
 * a dashboard gets when its author declares nothing. A draft cannot buy itself a better
 * class by asking; it gets the ordinary one until someone reviews it.
 */
function freshnessFor(published: PublishedChart | undefined): FreshnessClass {
  return published?.freshness ?? DEFAULT_FRESHNESS;
}

const NEEDS_ONE = 'a query needs either a published `chart` reference or an ad-hoc `query`';

function chartRefIn(body: QueryRequestBody): PublishedChartRef | undefined {
  const ref = body.chart;
  if (ref === undefined || ref === null) return undefined;
  const { dashboard, id } = ref;
  if (typeof dashboard !== 'string' || typeof id !== 'string') {
    throw new Error("`chart` must be { dashboard: string, id: string }");
  }
  return { dashboard, id };
}

/**
 * Turn a request into the query that will actually run and the class it will run under.
 *
 * A published chart supplies BOTH, together, which is the half of this that is easy to
 * get wrong: resolving only the class from the artifact while still executing the body's
 * query leaves the escalation intact one level up. A caller would name an `operational`
 * dashboard, send whatever query it liked, and collect the expensive class for a query
 * no one approved. The class is a promise about a specific reviewed query, so the pair
 * travels together or neither does.
 *
 * Sending both is refused rather than silently resolved either way. There is no reading
 * of "here is a published chart, and also a different query" that we can serve without
 * guessing which one the caller believed would run -- and a number produced from the
 * other one is exactly the confident-but-wrong answer this product exists to prevent.
 */
export function resolveQuery(ctx: SecurityContext, body: QueryRequestBody): GovernedQuery {
  // These routes carry no Ajv schema yet (ADR-006 D2 wants one; it is T-134's job), so
  // Fastify hands over whatever JSON parsed -- `null` and `"hello"` included. Checked
  // here so those arrive as the sentence below rather than as a TypeError with a
  // property name in it.
  if (typeof body !== 'object' || body === null) throw new Error(NEEDS_ONE);
  const ref = chartRefIn(body);
  if (ref !== undefined) {
    if (body.query !== undefined) {
      throw new Error('send `chart` or `query`, not both: a published chart supplies its own query');
    }
    const published = loadChart(ctx, ref);
    return {
      query: published.chart.query,
      freshness: freshnessFor(published),
      dashboard: ref.dashboard,
    };
  }
  if (body.query === undefined) throw new Error(NEEDS_ONE);
  return { query: body.query, freshness: freshnessFor(undefined), dashboard: undefined };
}
