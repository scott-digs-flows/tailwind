import { buildApp } from './app.ts';
import { close, migrate, redact } from './db.ts';

const PORT = Number(process.env['PORT'] ?? 3001);
const HOST = process.env['HOST'] ?? '0.0.0.0';

/**
 * Building the app can refuse: identity configured in a way that would trust an
 * unverified header stops the process here (see `principal.ts`). It is caught rather
 * than left to throw because there is no logger yet, and the default unhandled-rejection
 * output buries the one sentence an operator needs under a stack trace through Fastify.
 */
function boot() {
  try {
    return buildApp();
  } catch (err: unknown) {
    console.error(`\ntailwind-api refused to start:\n\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

const app = boot();

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
