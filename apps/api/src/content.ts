import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

/**
 * The identifier pattern from `schemas/v1/dashboard.json#/$defs/identifier`, restated
 * here because it is doing a second job: every artifact name that reaches this module
 * becomes a path segment, and the tenant separability ADR-014 D1 claims is a property of
 * those segments.
 *
 * An ALLOWLIST, not a blocklist on `..`. A blocklist has to anticipate `..`, `.`, `/`,
 * `\` (a separator on Windows and, more to the point, a separator that `node:path`'s
 * POSIX implementation happily leaves inside a single segment), NUL, a leading `/`,
 * percent-encoding and whatever the next runtime decides is a separator. This pattern
 * admits lower-case letters, digits and underscore and nothing else, so all of those are
 * excluded by construction rather than by having been thought of.
 *
 * It is also exactly the pattern a published dashboard's `name` must already match, so
 * nothing this rejects could have been a valid artifact in the first place.
 */
const ARTIFACT_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * Echo the caller's bytes back as little as possible.
 *
 * The rejection reaches a client, and `validate.ts` already learned this lesson in the
 * CLI: an unbounded string from the request, quoted into a message a human reads as the
 * system's verdict, can forge newlines and control characters into that verdict. Neither
 * this nor any other message here includes the RESOLVED path -- where our content root
 * lives on disk is not something a rejected caller needs to be told.
 */
/**
 * A reference the CALLER got wrong: a name that is not an artifact name, an artifact
 * that is not published, a chart that is not in the dashboard named.
 *
 * Separate from every other failure in this file because the two deserve different
 * answers and different disclosure. This one is a 400 and its message may be shown --
 * it says only what the caller already sent, run through `quoteInput`. A PUBLISHED
 * artifact that fails validation is not this: that is our fault, not theirs, and its
 * message carries the artifact's path on disk and its line numbers, so it stays a plain
 * Error and lands on the generic 500 sentence (`query-failure.ts`).
 */
export class UnknownArtifact extends Error {}

function quoteInput(value: string): string {
  // Control characters -- the NUL that truncates a path inside a C API, the
  // newline that forges a line -- become `?` rather than reaching the message.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/gu, '?');
  return `'${cleaned.length > 48 ? `${cleaned.slice(0, 48)}…` : cleaned}'`;
}

function checkName(kind: 'dashboard' | 'chart' | 'tenant', value: string): string {
  if (!ARTIFACT_NAME.test(value)) throw new UnknownArtifact(`invalid ${kind} name ${quoteInput(value)}`);
  return value;
}

/**
 * Where a tenant's dashboards live. Tenant is a path segment (ADR-014 D1), so artifacts
 * stay separable by tenant -- and the tenant is checked against the same pattern as the
 * artifact name, for the reason ADR-014's backstop exists: a control that assumes its
 * inputs are well-formed is a control that is complete and inert. `ctx` is branded and
 * resolved by one middleware today, but `resolveSecurityContext` only asserts the tenant
 * is non-empty, and a tenant of `..` would walk out of the content root carrying every
 * containment check below with it.
 */
function dashboardDir(ctx: SecurityContext): string {
  return join(contentRoot(), 'tenants', checkName('tenant', ctx.tenant), 'dashboards');
}

/**
 * The one place an artifact name becomes a path, so the guard cannot be on one door and
 * not the other. It was previously in `loadDashboard`, which left this exported
 * path-builder usable unguarded by the next caller -- `apps/render`, a drill-through, a
 * CLI subcommand -- and put the check somewhere other than the comment asserting the
 * invariant.
 */
export function dashboardPath(ctx: SecurityContext, name: string): string {
  const dir = dashboardDir(ctx);
  const path = join(dir, `${checkName('dashboard', name)}.dashboard.yml`);

  // Belt and braces. The pattern above is what SHOULD make this unreachable; this is
  // what makes the property true rather than implied. Containment is the question that
  // actually matters, and it is asked of the resolved path rather than of the input's
  // string form -- so if the pattern is ever relaxed (a `-`, a folder feature, an
  // upstream identifier change), this still fails closed instead of silently reading
  // another tenant's artifact.
  //
  // `dirname(...) !== dir` rather than `startsWith(dir)`: a prefix test passes for
  // `/content/tenants/internal_other/...`, which is a different tenant.
  if (dirname(resolve(path)) !== resolve(dir)) {
    throw new UnknownArtifact(`invalid dashboard name ${quoteInput(name)}`);
  }
  // Returned in the form it was built, NOT resolved: this string reaches the caller
  // inside a spec-validation message (`formatErrors`), and an absolute host path is more
  // than a rejected caller needs to know about where our content lives.
  return path;
}

export function loadDashboard(ctx: SecurityContext, name: string): Dashboard {
  const path = dashboardPath(ctx, name);
  if (!existsSync(path)) throw new UnknownArtifact(`dashboard ${quoteInput(name)} not found`);

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
  // The id is not a path segment -- it is matched against ids inside a file that has
  // already been validated -- so this is not the traversal guard. It is here so that one
  // rule covers everything a request may name, and so the id cannot become a path
  // segment later (a per-chart artifact, a screenshot filename) without the rule coming
  // along with it. Checked BEFORE the dashboard is read: a malformed id is a bad
  // request, not a reason to touch the filesystem.
  checkName('chart', ref.id);
  const dashboard = loadDashboard(ctx, ref.dashboard);
  const chart = dashboard.charts.find((c) => c.id === ref.id);
  if (chart === undefined) {
    throw new UnknownArtifact(
      `chart ${quoteInput(ref.id)} is not in published dashboard ${quoteInput(ref.dashboard)}`,
    );
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
