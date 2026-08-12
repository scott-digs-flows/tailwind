import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseSpec, formatErrors, type Dashboard } from '@tailwind/spec';
import type { SecurityContext } from '@tailwind/semantic';

/**
 * Reads published artifacts off disk. In M0 the "bundle" is the working tree; the
 * immutable per-merge bundle is ADR-007 / T-029. Kept behind this one function so
 * that swap is a one-file change rather than a search-and-replace.
 */
const CONTENT_ROOT = process.env['TAILWIND_CONTENT_ROOT'] ?? 'content';

export function dashboardPath(ctx: SecurityContext, name: string): string {
  // Tenant is a path segment (ADR-014 D1), so artifacts stay separable by tenant.
  return join(CONTENT_ROOT, 'tenants', ctx.tenant, 'dashboards', `${name}.dashboard.yml`);
}

export function loadDashboard(ctx: SecurityContext, name: string): Dashboard {
  // The name is a path segment: refuse anything that could escape the tenant root.
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`invalid dashboard name '${name}'`);
  const path = dashboardPath(ctx, name);
  if (!existsSync(path)) throw new Error(`dashboard '${name}' not found`);

  // Validated on read with the SAME validator the CLI and CI use (FR-SEM-11). A spec
  // that would fail CI cannot be served just because it reached disk.
  const result = parseSpec<Dashboard>('dashboard', readFileSync(path, 'utf8'));
  if (!result.ok) throw new Error(formatErrors(path, result.errors));
  return result.value;
}
