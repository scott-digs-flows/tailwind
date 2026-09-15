import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseSpec,
  formatErrors,
  type Dashboard,
  type DashboardChart,
  type FreshnessClass,
} from '@tailwind/spec';
import type { SecurityContext } from '@tailwind/semantic';

/**
 * Reads published artifacts off disk. In M0 the "bundle" is the working tree; the
 * immutable per-merge bundle is ADR-007 / T-029. Kept behind this one function so
 * that swap is a one-file change rather than a search-and-replace.
 *
 * Read fresh from the environment on every call rather than captured at import, for the
 * same reason `packages/semantic/src/engine-config.ts` does it: it is a property lookup,
 * the serving tier is stateless (binding constraint 6), and a value captured at module
 * load is one more thing that can be stale in a process that outlives a config change.
 */
function contentRoot(): string {
  return process.env['TAILWIND_CONTENT_ROOT'] ?? 'content';
}

export function dashboardPath(ctx: SecurityContext, name: string): string {
  // Tenant is a path segment (ADR-014 D1), so artifacts stay separable by tenant.
  return join(contentRoot(), 'tenants', ctx.tenant, 'dashboards', `${name}.dashboard.yml`);
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

/** Which chart, in which published dashboard. The whole of what a caller may name. */
export interface PublishedChartRef {
  dashboard: string;
  id: string;
}

/**
 * A chart as the data team reviewed it: its query and the freshness class that governs
 * how it is executed, both read from git (binding constraint 1) rather than from the
 * request that asked for it.
 */
export interface PublishedChart {
  dashboard: Dashboard;
  chart: DashboardChart;
  freshness: FreshnessClass;
}

export function loadChart(ctx: SecurityContext, ref: PublishedChartRef): PublishedChart {
  const dashboard = loadDashboard(ctx, ref.dashboard);
  const chart = dashboard.charts.find((c) => c.id === ref.id);
  if (chart === undefined) {
    throw new Error(`chart '${ref.id}' is not in published dashboard '${ref.dashboard}'`);
  }
  return { dashboard, chart, freshness: effectiveFreshness(dashboard, chart) };
}

/**
 * The class this chart executes under (FR-FRESH-01).
 *
 * It is the dashboard's, because a chart-level class is not expressible today: the
 * requirement says "charts may override downward within a dashboard" and
 * `schemas/v1/dashboard.json` has no per-chart `freshness` block. The function exists
 * anyway, taking the chart it does not yet read, because this is the one place that
 * override lands when the schema grows it -- and a caller reading
 * `dashboard.freshness.class` directly is a caller that would go on ignoring the
 * override afterwards.
 *
 * Note the direction the gap leaves us in: every chart inherits the dashboard's class,
 * so nothing here can resolve to a class STRICTER than what was reviewed. That is the
 * safe side of the gap, which is why it is a note and not a blocker.
 */
function effectiveFreshness(dashboard: Dashboard, chart: DashboardChart): FreshnessClass {
  void chart;
  return dashboard.freshness.class;
}
