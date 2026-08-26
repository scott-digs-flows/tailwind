import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createClient, type RedisClientType } from 'redis';
import type { SecurityContext } from '@tailwind/semantic';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Connections to the OPERATIONAL datastore. Note what is absent: any warehouse
 * connection. ADR-003 D5 routes execution through Cube, which owns the warehouse
 * credentials and its own pool -- so a second connection here would be a second door
 * to the numbers, which binding constraint 2 forbids.
 *
 * Credentials come from the environment and are never logged (NFR-SEC-01). The URL is
 * redacted before it reaches any log line.
 */
export const redact = (url: string): string => url.replace(/\/\/[^@/]*@/, '//***:***@');

/**
 * TWO connection strings, deliberately:
 *   DATABASE_ADMIN_URL -- the owner. DDL only, used by migrate() at boot.
 *   DATABASE_URL       -- tailwind_app, a NON-superuser. Everything else.
 * A superuser bypasses RLS no matter what the table says, so running the app as the
 * owner would make ADR-014's backstop decorative.
 */
let pool: pg.Pool | undefined;
let adminPool: pg.Pool | undefined;
let redis: RedisClientType | undefined;

export function getPool(): pg.Pool {
  if (pool === undefined) {
    pool = new pg.Pool({
      connectionString: process.env['DATABASE_URL'] ?? 'postgres://tailwind:tailwind@localhost:7432/tailwind',
      max: Number(process.env['PG_POOL_MAX'] ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

export async function getRedis(): Promise<RedisClientType> {
  if (redis === undefined) {
    redis = createClient({ url: process.env['REDIS_URL'] ?? 'redis://localhost:7379' });
    redis.on('error', () => undefined); // handled by the health check, not by crashing
    await redis.connect();
  }
  return redis;
}

function getAdminPool(): pg.Pool {
  adminPool ??= new pg.Pool({
    connectionString: process.env['DATABASE_ADMIN_URL'] ?? process.env['DATABASE_URL'] ?? '',
    max: 2,
  });
  return adminPool;
}

/** Idempotent, ordered, applied at boot as the OWNER. Enough for a POC; ADR-007 owns the rest. */
export async function migrate(): Promise<string[]> {
  const dir = join(HERE, '..', 'migrations');
  const applied: string[] = [];
  const admin = getAdminPool();
  // The app role's password is passed as a transaction-local setting so it never
  // appears in the migration file or in pg_stat_activity's query text.
  const appPassword = process.env['APP_DB_PASSWORD'] ?? 'tailwind_app';
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['tailwind.app_password', appPassword]);
      await client.query(readFileSync(join(dir, file), 'utf8'));
      await client.query('COMMIT');
      applied.push(file);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  await admin.end();
  adminPool = undefined;
  return applied;
}

/**
 * Run inside a transaction with the tenant set, so ADR-014's RLS policy applies.
 * `set_config(..., true)` is transaction-local: it cannot leak to the next borrower
 * of this pooled connection, which is the classic way session state escapes a pool.
 */
export async function withTenant<T>(ctx: SecurityContext, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['tailwind.tenant_id', ctx.tenant]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export interface Health {
  postgres: 'up' | 'down';
  redis: 'up' | 'down';
}

export async function health(): Promise<Health> {
  const [p, r] = await Promise.all([
    getPool().query('SELECT 1').then(() => 'up' as const).catch(() => 'down' as const),
    getRedis().then((c) => c.ping()).then(() => 'up' as const).catch(() => 'down' as const),
  ]);
  return { postgres: p, redis: r };
}

export async function close(): Promise<void> {
  await pool?.end();
  await redis?.quit();
  pool = undefined;
  redis = undefined;
}
