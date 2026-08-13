import type { FastifyInstance } from 'fastify';
import { runQuery, pocSystemContext, type CubeClientOptions } from '@tailwind/semantic';
import type { ChartQuery } from '@tailwind/spec';
import { envelope } from './envelope.ts';
import { loadDashboard } from './content.ts';
import { health } from './db.ts';
import { recordQuery } from './audit.ts';

const cube: CubeClientOptions = {
  url: process.env['CUBE_URL'] ?? 'http://localhost:4000/cubejs-api/v1',
  apiSecret: process.env['CUBEJS_API_SECRET'] ?? 'dev-only-not-a-secret',
};

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
  app.post<{ Body: { query: ChartQuery; freshness?: 'batch' | 'standard' | 'operational' } }>(
    '/v1/queries',
    async (req, reply) => {
      const ctx = pocSystemContext();
      const started = Date.now();
      try {
        const result = await runQuery(cube, req.body.query, ctx);
        recordQuery(
          {
            ctx,
            view: req.body.query.view,
            metrics: req.body.query.metrics,
            sql: result.sql,
            rowCount: result.rows.length,
            durationMs: Date.now() - started,
            traceId: req.id,
          },
          (e) => app.log.warn({ err: e }, 'audit write failed'),
        );
        return envelope({ rows: result.rows, sql: result.sql }, ctx, {
          traceId: req.id,
          // Our cache is T-025/M1. Saying "bypass" is honest; claiming a miss would not be.
          cache: 'bypass',
          freshnessClass: req.body.freshness ?? 'standard',
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
