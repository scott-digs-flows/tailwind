import { buildApp } from './app.ts';
import { close, migrate, redact } from './db.ts';

const PORT = Number(process.env['PORT'] ?? 3001);
const HOST = process.env['HOST'] ?? '0.0.0.0';

const app = buildApp();

// Migrations run at boot: idempotent, ordered, and cheap. ADR-007 owns the real
// publish pipeline; this is enough for a single-VM POC.
try {
  const applied = await migrate();
  app.log.info({ applied, database: redact(process.env['DATABASE_URL'] ?? '') }, 'migrations applied');
} catch (err: unknown) {
  app.log.error({ err }, 'migration failed');
  process.exit(1);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void app.close().then(close).then(() => process.exit(0));
  });
}

app.listen({ port: PORT, host: HOST }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
