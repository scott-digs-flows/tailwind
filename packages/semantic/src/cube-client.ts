import { createHmac } from 'node:crypto';
import type { SecurityContext } from './security-context.ts';

/**
 * The ONLY module permitted to speak to Cube. ADR-006's "one door" is a MODULE
 * boundary, not a process boundary: apps/api and apps/render both import the
 * facade, and nothing else imports this file. If a second caller appears, the
 * governance guarantee in binding constraint 2 is gone.
 */
export interface CubeClientOptions {
  url: string;
  apiSecret: string;
}

export interface CubeResultSet {
  data: Record<string, unknown>[];
  annotation: unknown;
  lastRefreshTime?: string;
}

function mintToken(secret: string, ctx: SecurityContext): string {
  // The security context travels INTO Cube as JWT claims, which is what
  // access_policy row_level filters read. Per request, never per tenant
  // (FR-SEM-15) -- COMPILE_CONTEXT could not express this.
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = enc({ alg: 'HS256', typ: 'JWT' });
  const payload = enc({
    exp: Math.floor(Date.now() / 1000) + 120,
    tenant: ctx.tenant,
    subject: ctx.subject,
    groups: [...ctx.groups],
  });
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/**
 * Cube long-polls: while a query is still computing it answers HTTP 200 with
 * `{"error":"Continue wait"}` and expects the SAME request to be re-sent. Treating
 * that as a failure makes queries fail intermittently on a cold model or under load --
 * the worst kind of bug, because it passes every time you test it warm.
 */
const CONTINUE_WAIT = 'Continue wait';
const MAX_WAIT_MS = 30_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function post(opts: CubeClientOptions, path: string, body: unknown, ctx: SecurityContext): Promise<unknown> {
  const deadline = Date.now() + MAX_WAIT_MS;
  let attempt = 0;

  for (;;) {
    const res = await fetch(`${opts.url}${path}`, {
      method: 'POST',
      // A fresh token per attempt: the 120s expiry could otherwise lapse mid-wait.
      headers: { 'Content-Type': 'application/json', Authorization: mintToken(opts.apiSecret, ctx) },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Cube returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    const err = (parsed as { error?: string }).error;

    if (err === CONTINUE_WAIT) {
      if (Date.now() >= deadline) {
        throw new Error(`Cube did not finish within ${MAX_WAIT_MS}ms (still "${CONTINUE_WAIT}")`);
      }
      // Gentle backoff, capped: Cube is already blocking server-side, so this is a
      // reconnect interval rather than a poll interval.
      attempt += 1;
      await sleep(Math.min(250 * attempt, 1_000));
      continue;
    }

    if (!res.ok || typeof err === 'string') {
      throw new Error(`Cube error (HTTP ${res.status}): ${err ?? text.slice(0, 200)}`);
    }
    return parsed;
  }
}

/** Generated SQL WITHOUT executing it -- FR-CON-02's "how is this calculated?". */
export async function cubeSql(opts: CubeClientOptions, query: unknown, ctx: SecurityContext): Promise<string> {
  const out = (await post(opts, '/sql', { query }, ctx)) as { sql?: { sql?: [string, unknown[]] } };
  const pair = out.sql?.sql;
  return Array.isArray(pair) ? String(pair[0]) : '';
}

export async function cubeLoad(opts: CubeClientOptions, query: unknown, ctx: SecurityContext): Promise<CubeResultSet> {
  const out = (await post(
    opts,
    '/load',
    // ADR-003 D5: Cube's own caching is bypassed so OUR cache is the only cache.
    // Two caches with independent invalidation is how stale numbers get served.
    // ("Disable caching" is not achievable in Cube; per-request no-cache is the mechanism.)
    { query, queryType: 'multi', cache: 'no-cache' },
    ctx,
  )) as { results?: { data?: Record<string, unknown>[]; annotation?: unknown; lastRefreshTime?: string }[] };
  const first = out.results?.[0];
  return {
    data: first?.data ?? [],
    annotation: first?.annotation ?? {},
    ...(first?.lastRefreshTime !== undefined ? { lastRefreshTime: first.lastRefreshTime } : {}),
  };
}

export async function cubeMeta(opts: CubeClientOptions, ctx: SecurityContext): Promise<unknown> {
  const res = await fetch(`${opts.url}/meta`, { headers: { Authorization: mintToken(opts.apiSecret, ctx) } });
  if (!res.ok) throw new Error(`Cube /meta failed: HTTP ${res.status}`);
  return res.json();
}
