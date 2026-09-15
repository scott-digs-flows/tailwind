import type { FastifyInstance } from 'fastify';
import { runQuery, pocSystemContext } from '@tailwind/semantic';
import { envelope } from './envelope.ts';
import { classifyQueryFailure, failureNotice } from './query-failure.ts';
import { loadDashboard, UnknownArtifact } from './content.ts';
import { health } from './db.ts';
import { recordQuery } from './audit.ts';
import { principalOf, registerPrincipalResolution } from './principal.ts';
import { resolveQuery, type QueryRequestBody } from './queries.ts';

export function registerRoutes(app: FastifyInstance): void {
  // Identity first, and registered here rather than in the app builder so that no route
  // in this file can be served without it. Every handler below reads its context from
  // `principalOf(req)`, which throws if this hook did not run (FR-SEM-14, ADR-014 D2).
  registerPrincipalResolution(app);

  app.get('/healthz', async (req, reply) => {
    const deps = await health();
    const ok = deps.postgres === 'up' && deps.redis === 'up';
    // Report degraded rather than lying: a health check that returns 200 while its
    // datastore is down is how a broken deploy looks healthy (the same shape as the
    // Cube Store trap in T-118).
    if (!ok) reply.code(503);
    // The one anonymous endpoint (see ANONYMOUS_PATHS), so it has no principal to read:
    // a liveness check that needs an identity is a deploy nobody can diagnose. It
    // carries no rows either, which is why a system context is honest here and would not
    // be on any route below.
    return envelope({ status: ok ? 'ok' : 'degraded', service: 'api', deps }, pocSystemContext(), {
      traceId: req.id,
      cache: 'bypass',
    });
  });

  app.get<{ Params: { name: string } }>('/v1/dashboards/:name', async (req, reply) => {
    // Resolved by the identity hook before this handler was reached, from the requesting
    // user and never from the artifact's author (binding constraint 4). SSO is TW-89;
    // what changes then is where the claim comes from, not this line.
    const ctx = principalOf(req);
    try {
      return envelope(loadDashboard(ctx, req.params.name), ctx, {
        traceId: req.id,
        cache: 'bypass',
      });
    } catch (e: unknown) {
      // The raw error goes to the log, never to the browser. `loadDashboard` raises
      // either "not found" or the validator's findings, and the findings carry the
      // artifact's path on disk and its line numbers -- useful in a CI job, a
      // filesystem layout disclosed to a reader in a browser (NFR-SEC-05).
      req.log.warn({ err: e, dashboard: req.params.name }, 'dashboard could not be served');
      const message =
        'This dashboard could not be opened. It may have been renamed or not yet ' +
        'published -- the data team can confirm which.';
      reply.code(404);
      // Said twice, in `data.error` and in a notice, because the two have different
      // readers: `data.error` is what a caller of this endpoint destructures, the
      // notice is what any surface rendering the envelope shows without special-casing
      // this route (ADR-006 amendment, rule 1).
      return envelope({ error: message }, ctx, {
        traceId: req.id,
        cache: 'bypass',
        notices: [{ code: 'query_failed', severity: 'error', message }],
      });
    }
  });

  /**
   * ADR-006 D3 specifies queries as jobs with an SSE event stream. M0 answers in one
   * round trip because a seeded DuckDB query is ~50ms, and the job/stream machinery is
   * ticketed separately (T-134) rather than skipped -- the response SHAPE here already
   * matches what the streaming path will return, so M2 adds an event type, not a transport.
   */
  app.post<{ Body: QueryRequestBody }>(
    '/v1/queries',
    async (req, reply) => {
      const ctx = principalOf(req);
      const started = Date.now();
      try {
        // Both governed inputs are resolved server-side, from two different sources of
        // truth, and neither is readable off the request: the security context from the
        // principal (FR-SEM-14/15), the query and its freshness class from the published
        // artifact in git (FR-FRESH-01/04, ADR-006 amendment B2). A `freshness` field in
        // the body reaches no parameter of anything below -- see `queries.ts`.
        const governed = resolveQuery(ctx, req.body);
        const result = await runQuery(ctx, governed.query, governed.freshness);
        recordQuery(
          {
            ctx,
            view: governed.query.view,
            metrics: governed.query.metrics,
            sql: result.sql,
            engineLimit: result.engineLimit,
            rowCount: result.rows.length,
            durationMs: Date.now() - started,
            traceId: req.id,
            // Recorded now that the request says which artifact it is running, rather
            // than being written NULL on every row since T-010. FR-FRESH-06's
            // declared-versus-achieved question is answerable only per dashboard.
            ...(governed.dashboard !== undefined ? { dashboard: governed.dashboard } : {}),
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
        // FR-VIZ-13. A chart whose query fails must say so in place, in language a
        // business user can act on -- so the plain-language translation happens here,
        // where what actually went wrong is still known, and the raw error goes to the
        // log under the same trace id the reader is shown. Previously `e.message` went
        // straight to the browser, which could put the engine's name and a fragment of
        // the generated SQL on a dashboard.
        // A caller who named something that is not published has made a 400, not
        // caused a 500, and `classifyQueryFailure` is deliberately not the judge of
        // that: it classifies EXECUTION failures by the requirement IDs our own
        // refusals carry, so a resolution refusal -- which carries none -- would land
        // on the generic "something went wrong" and report the fault as ours. These
        // messages are safe to show: they say only what the caller sent, quoted
        // through `quoteInput`. A published artifact that fails validation is NOT an
        // UnknownArtifact and still falls through below, because its message carries
        // the artifact's path on disk.
        if (e instanceof UnknownArtifact) {
          req.log.warn({ err: e }, 'query request could not be resolved');
          reply.code(400);
          return envelope({ error: e.message }, ctx, {
            traceId: req.id,
            cache: 'bypass',
            notices: [{ code: 'query_failed', severity: 'error', message: e.message }],
          });
        }
        const failure = classifyQueryFailure(e);
        // Both shapes, because either may be absent: a published request carries no
        // `query` and an ad-hoc one carries no `chart`. Logging only the view was right
        // when every request carried one, and TW-167 made that untrue -- a published
        // chart that fails would otherwise log `undefined` and name nothing.
        req.log.error(
          { err: e, code: failure.code, chart: req.body?.chart, view: req.body?.query?.view },
          'chart query failed',
        );
        reply.code(failure.status);
        return envelope({ error: failure.message }, ctx, {
          traceId: req.id,
          cache: 'bypass',
          notices: [failureNotice(failure)],
        });
      }
    },
  );
}
