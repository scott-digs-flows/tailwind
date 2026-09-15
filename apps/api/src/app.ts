import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerRoutes } from './routes.ts';

/**
 * The serving tier, assembled and not started.
 *
 * Split out of `server.ts` so that a test can exercise the REAL serving path -- the same
 * hooks, the same routes, the same envelope -- without a listening socket, a database
 * migration or a process to tear down. `server.ts` runs migrations and binds a port at
 * import time, so importing it from a test would boot a server as a side effect of
 * asking a question about a route.
 *
 * TW-174's end-to-end proof calls this and then `app.inject()`. That matters more than
 * it looks: a test that reconstructed the routes itself would be asserting against its
 * own wiring, and the identity middleware -- the thing under test -- is exactly what
 * such a reconstruction would get wrong.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({
    genReqId: () => randomUUID(),
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
  });
  registerRoutes(app);
  return app;
}
