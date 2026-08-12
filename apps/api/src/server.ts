import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { envelope } from './envelope.ts';
import { pocSystemContext } from './security-context.ts';

const PORT = Number(process.env['PORT'] ?? 3001);
const HOST = process.env['HOST'] ?? '0.0.0.0';

export function build() {
  const app = Fastify({
    genReqId: () => randomUUID(),
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
  });

  /**
   * T-010 ships exactly ONE route, deliberately. The deliverable is the envelope
   * shape and the trace id, not the endpoint -- everything else waits on T-012
   * (schemas) and T-014 (the Cube facade). Do not add a second route here.
   */
  app.get('/healthz', async (req) =>
    envelope({ status: 'ok', service: 'api' }, pocSystemContext(), {
      traceId: req.id,
      cache: 'bypass',
    }),
  );

  return app;
}

const app = build();
app.listen({ port: PORT, host: HOST }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
