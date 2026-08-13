import type { SecurityContext } from '@tailwind/semantic';
import { securityContextDigest } from '@tailwind/semantic';
import { withTenant } from './db.ts';

export interface QueryAudit {
  ctx: SecurityContext;
  view: string;
  metrics: string[];
  sql: string;
  rowCount: number;
  durationMs: number;
  traceId: string;
  dashboard?: string;
}

/**
 * FR-SEC-07. Every query execution is recorded: who, what, which SQL, how long.
 *
 * Deliberately fire-and-forget with a swallowed error. An audit write failing must not
 * fail the user's query -- but it must be visible, so it logs. If audit completeness
 * ever becomes a compliance requirement rather than an operational one, this inverts
 * and the write becomes blocking; that is a deliberate change, not a bug fix.
 */
export function recordQuery(a: QueryAudit, onError: (e: unknown) => void): void {
  void withTenant(a.ctx, async (c) => {
    await c.query(
      `INSERT INTO query_log
         (tenant_id, subject, security_context_digest, dashboard, view_name,
          metrics, generated_sql, row_count, duration_ms, trace_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [a.ctx.tenant, a.ctx.subject, securityContextDigest(a.ctx), a.dashboard ?? null,
       a.view, a.metrics, a.sql, a.rowCount, a.durationMs, a.traceId],
    );
  }).catch(onError);
}
