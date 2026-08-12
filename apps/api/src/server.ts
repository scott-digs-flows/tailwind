import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { registerRoutes } from './routes.ts';

const PORT = Number(process.env['PORT'] ?? 3001);
const HOST = process.env['HOST'] ?? '0.0.0.0';

export function build() {
  const app = Fastify({
    genReqId: () => randomUUID(),
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
  });
  registerRoutes(app);
  return app;
}

const app = build();
app.listen({ port: PORT, host: HOST }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
