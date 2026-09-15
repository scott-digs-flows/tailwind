import type { FastifyInstance } from 'fastify';
import { runQuery, pocSystemContext } from '@tailwind/semantic';
import {
  DEFAULT_FRESHNESS,
  isFreshnessClass,
  type ChartQuery,
  type FreshnessClass,
} from '@tailwind/spec';
import { envelope } from './envelope.ts';
import { loadDashboard } from './content.ts';
import { health } from './db.ts';
import { recordQuery } from './audit.ts';

/**
 * The one place the executed freshness class is chosen -- deliberately one place,
 * because it is about to move.
 *
 * Today it still comes from the request body, which is the second half of ADR-006's
 * 2026-09-14 amendment and is **TW-167**, not this ticket. A client-chosen class is an
 * ungoverned cache-policy and cost knob, and it routes around FR-FRESH-04's approval
 * gate for `operational`: the spec validator refuses that class in a reviewed artifact
 * while this endpoint accepts it in a body. It is harmless only while no cache exists.
 *
 * TW-167 replaces the body read below with a lookup of the class declared by the
 * published artifact; the ad-hoc path gets this server-chosen default, never a
 * client-chosen one. Everything else on the query path already takes the class from
 * what the facade executed under, so that change lands here and nowhere else.
 */
function freshnessFor(body: { freshness?: unknown }): FreshnessClass {
  return isFreshnessClass(body.freshness) ? body.freshness : DEFAULT_FRESHNESS;
}

export function registerRoutes(app: FastifyInstance): void {
  app.get('/healthz', async (req, reply) => {
    const deps = await health();
    const ok = deps.postgres === 'up' && deps.redis === 'up';
    // Report degraded rather than lying: a health check that returns 200 while its
    // datastore is down is how a broken deploy looks healthy (the same shape as the
    // Cube Store trap in T-118).
    if (!ok) reply.code(503);
    return envelope({ status: ok ? 'ok' : 'degraded', service: 'api', deps }, pocSystemContext(), {
      traceId: req.id,
      cache: 'bypass',
    });
  });

  app.get<{ Params: { name: string } }>('/v1/dashboards/:name', async (req, reply) => {
    // SSO is M1 (T-072). Until then the context resolves permissively -- but it is
    // resolved per request and threaded everywhere, so wiring real identity later
    // changes one function rather than every call site (08-poc-scope.md 3.1).
    const ctx = pocSystemContext();
    try {
      return envelope(loadDashboard(ctx, req.params.name), ctx, {
        traceId: req.id,
        cache: 'bypass',
      });
    } catch (e: unknown) {
      reply.code(404);
      return envelope({ error: e instanceof Error ? e.message : String(e) }, ctx, {
        traceId: req.id,
        cache: 'bypass',
      });
    }
  });

  /**
   * ADR-006 D3 specifies queries as jobs with an SSE event stream. M0 answers in one
   * round trip because a seeded DuckDB query is ~50ms, and the job/stream machinery is
   * ticketed separately (T-134) rather than skipped -- the response SHAPE here already
   * matches what the streaming path will return, so M2 adds an event type, not a transport.
   */
  app.post<{ Body: { query: ChartQuery; freshness?: FreshnessClass } }>(
    '/v1/queries',
    async (req, reply) => {
      const ctx = pocSystemContext();
      const started = Date.now();
      try {
        const result = await runQuery(ctx, req.body.query, freshnessFor(req.body));
        recordQuery(
          {
            ctx,
            view: req.body.query.view,
            metrics: req.body.query.metrics,
            sql: result.sql,
            engineLimit: result.engineLimit,
            rowCount: result.rows.length,
            durationMs: Date.now() - started,
            traceId: req.id,
          },
          (e) => app.log.warn({ err: e }, 'audit write failed'),
        );
        return envelope({ rows: result.rows, sql: result.sql }, ctx, {
          traceId: req.id,
          // FR-ADM-03's cap is deliberate; hiding that it fired is not. A truncated
          // result that renders as a complete chart is the exact failure this product
          // exists to prevent.
          notices: result.truncated
            ? [
                {
                  code: 'row_limit_reached' as const,
                  severity: 'warn' as const,
                  message:
                    `Showing the first ${result.rowLimit.toLocaleString()} rows. ` +
                    `There are more -- narrow the filters or group by something coarser.`,
                },
              ]
            : [],
          // Both of these now come from the facade rather than from this module. The
          // route cannot know whether a cache answered, and a class it labels from its
          // own variable is a claim about execution it did not observe: with the class
          // an input to `runQuery`, the label and the policy that ran are the same
          // value by construction. Today that value is always `bypass` -- honest, where
          // claiming a miss would not be.
          cache: result.cache,
          freshnessClass: result.freshness,
          ...(result.asOf !== undefined ? { asOf: result.asOf } : {}),
        });
      } catch (e: unknown) {
        reply.code(400);
        return envelope({ error: e instanceof Error ? e.message : String(e) }, ctx, {
          traceId: req.id,
          cache: 'bypass',
        });
      }
    },
  );
}
