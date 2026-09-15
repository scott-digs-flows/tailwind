/**
 * TW-174. Two people open one dashboard and get different numbers -- proven end to end,
 * on every build, against the CI fixture.
 *
 *   node apps/api/test/e2e/rls-two-users.ts [--negative-control=<label>]
 *
 * ## Why this exists when the facade already has a two-user check
 *
 * `packages/semantic/test/manual/rls-check.ts` (T-117) proves the property one layer
 * down, and it is manual. This one runs the whole serving path -- HTTP request, identity
 * middleware, dashboard artifact off disk, facade, JWT claims, Cube `access_policy`,
 * ClickHouse -- and it runs in CI. The gap between the two is where this class of bug
 * actually lives: a facade that scopes correctly is worth nothing if the route hands it
 * a context resolved from the wrong place, and no unit test of either half sees that.
 *
 * ## Why the two subjects share a tenant
 *
 * FR-SEM-15: predicates resolve per REQUEST, not per tenant. Two users of two tenants
 * would differ under a per-tenant mechanism too -- Cube's `COMPILE_CONTEXT` would pass
 * that test while being exactly the thing the requirement forbids relying on. So both
 * subjects here are `internal`, and every row difference below is attributable to the
 * subject alone.
 *
 * ## Why these queries
 *
 * They are lifted from the published dashboard, not written here: the run fetches
 * `sales_overview` through the API and executes its own chart queries. A query invented
 * by the test would prove that the engine can filter rows; taking the dashboard's proves
 * that the thing a person actually opens does.
 *
 * ## The negative controls
 *
 * A suite that still passes with the mechanism disabled is testing nothing (T-136/T-137).
 * `scripts/rls-e2e.sh` runs this file a second time with the reviewed row filter
 * weakened to nothing, and every check tagged `disabledBy: 'unfiltered-policy'` must
 * fail. The rejection check carries its own control in-process -- see `no-principal`.
 */
import { buildApp } from '../../src/app.ts';
import { DIRECTORY_ENV, SUBJECT_HEADER, TRUST_UNVERIFIED_SUBJECT_ENV } from '../../src/principal.ts';

/**
 * Two principals, ONE tenant. Set before the app is built; the API reads the directory
 * per request, so this is configuration of the serving tier, not a seam into it.
 *
 * The groups are the ones the reviewed `sales` view declares an `access_policy` for.
 * They are the pilot area's placeholder policies, not its real row rules (TW-86) -- this
 * proof does not wait on those, it only needs two entitlements that genuinely differ.
 */
const TENANT = 'internal';
const WIDE = 'morgan'; // sees everything the view exposes
const NARROW = 'wes'; // restricted to one territory group by the reviewed policy
const STRANGER = 'dana'; // authenticates to nothing: no directory entry, no tenant

process.env[DIRECTORY_ENV] = JSON.stringify([
  { subject: WIDE, tenant: TENANT, groups: ['analyst'] },
  { subject: NARROW, tenant: TENANT, groups: ['europe_only'] },
]);
// The admission that goes with it: a directory alone refuses to start, because the
// subject header is not authenticated until TW-89. A test impersonating two people is
// exactly the case the flag is for, and saying so here is cheaper than a reader
// wondering whether the API is this easy to fool by default. It is not.
process.env[TRUST_UNVERIFIED_SUBJECT_ENV] = '1';

const DASHBOARD = 'sales_overview';
/** A table of rows, and a single-number KPI. Both are on the same dashboard, and the
 *  first is where a leak shows up as rows while the second is where it shows up as a
 *  headline figure someone would quote in a meeting. */
const ROWS_CHART = 'by_country';
const KPI_CHART = 'internet_total';

const app = buildApp();

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

async function get(url: string, subject?: string): Promise<Reply> {
  const res = await app.inject({ method: 'GET', url, headers: headersFor(subject) });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

async function post(url: string, payload: unknown, subject?: string): Promise<Reply> {
  const res = await app.inject({ method: 'POST', url, payload, headers: headersFor(subject) });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

function headersFor(subject?: string): Record<string, string> {
  return subject === undefined ? {} : { [SUBJECT_HEADER]: subject };
}

const data = (r: Reply): Record<string, unknown> => (r.body['data'] ?? {}) as Record<string, unknown>;
const meta = (r: Reply): Record<string, unknown> => (r.body['meta'] ?? {}) as Record<string, unknown>;
const rowsOf = (r: Reply): Record<string, unknown>[] => (data(r)['rows'] ?? []) as Record<string, unknown>[];
const sqlOf = (r: Reply): string => String(data(r)['sql'] ?? '');

interface Chart {
  id: string;
  query: unknown;
}

/** Every chart on the dashboard, as the API serves it to that subject. */
async function chartsFor(subject: string): Promise<Map<string, Chart>> {
  const reply = await get(`/v1/dashboards/${DASHBOARD}`, subject);
  if (reply.status !== 200) throw new Error(`dashboard ${DASHBOARD} not served to ${subject}: HTTP ${reply.status}`);
  const charts = (data(reply)['charts'] ?? []) as Chart[];
  return new Map(charts.map((c) => [c.id, c]));
}

async function runChart(subject: string | undefined, chart: Chart): Promise<Reply> {
  return post('/v1/queries', { query: chart.query }, subject);
}

/**
 * Count requests to the engine while `fn` runs.
 *
 * This is how "rejected BEFORE any SQL is built" is asserted rather than assumed. A 403
 * with an empty body looks identical whether the request was refused at the door or
 * compiled, executed and then discarded -- and only one of those is what FR-SEM-14 asks
 * for. Counting the calls the facade makes to the engine distinguishes them: zero bytes
 * left the process.
 */
async function withEngineCallCount<T>(fn: () => Promise<T>): Promise<{ result: T; calls: number }> {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    calls += 1;
    return real(...args);
  }) as typeof fetch;
  try {
    return { result: await fn(), calls };
  } finally {
    globalThis.fetch = real;
  }
}

type ControlLabel = 'unfiltered-policy';

interface Check {
  id: string;
  why: string;
  /**
   * The negative control under which this check MUST fail. A check with no label is one
   * the control does not touch -- reported, but not evidence either way.
   */
  disabledBy?: ControlLabel;
  run: () => Promise<void>;
}

/** Thrown by a check to fail it. Anything else thrown is a fault in the test itself and
 *  is reported differently, because "the suite crashed" is not "the property is false". */
class CheckFailed extends Error {}
// A function declaration, not a const arrow: TypeScript only narrows on a
// `never`-returning call when it can see the declaration, and every `fail()` below is
// followed by code that relies on the value it just rejected being gone.
function fail(message: string): never {
  throw new CheckFailed(message);
}

const sorted = (xs: unknown[]): string[] => xs.map(String).sort();

const CHECKS: Check[] = [
  {
    id: 'one-dashboard-two-readers',
    why: 'both principals are served the same dashboard artifact, so any difference below is about rows',
    run: async () => {
      const [wide, narrow] = await Promise.all([chartsFor(WIDE), chartsFor(NARROW)]);
      const ids = (m: Map<string, Chart>): string => [...m.keys()].sort().join(',');
      if (ids(wide) !== ids(narrow)) fail(`different dashboards: ${ids(wide)} vs ${ids(narrow)}`);
      if (!wide.has(ROWS_CHART) || !wide.has(KPI_CHART)) {
        fail(`${DASHBOARD} no longer has charts '${ROWS_CHART}' and '${KPI_CHART}'`);
      }
    },
  },
  {
    id: 'same-tenant-different-context',
    why: 'the two contexts differ by SUBJECT alone -- what makes this a per-request proof, not a per-tenant one',
    run: async () => {
      const chart = (await chartsFor(WIDE)).get(KPI_CHART);
      if (chart === undefined) fail(`chart '${KPI_CHART}' is missing`);
      const [a, b] = await Promise.all([runChart(WIDE, chart), runChart(NARROW, chart)]);
      const digestA = String(meta(a)['security_context_digest']);
      const digestB = String(meta(b)['security_context_digest']);
      if (digestA === digestB) fail('two subjects produced one security-context digest');
      // The tenant is not in the response by design (it is inside the digest), so this
      // asserts what the test CONFIGURED: both principals belong to the same tenant.
      const configured = JSON.parse(process.env[DIRECTORY_ENV] ?? '[]') as { subject: string; tenant: string }[];
      const tenants = new Set(configured.filter((p) => p.subject === WIDE || p.subject === NARROW).map((p) => p.tenant));
      if (tenants.size !== 1) fail(`the two principals must share a tenant, got ${[...tenants].join(', ')}`);
    },
  },
  {
    id: 'different-rows',
    why: 'the restricted reader sees a strict subset of the rows, from the same chart on the same dashboard',
    disabledBy: 'unfiltered-policy',
    run: async () => {
      const chart = (await chartsFor(WIDE)).get(ROWS_CHART);
      if (chart === undefined) fail(`chart '${ROWS_CHART}' is missing`);
      const [wide, narrow] = await Promise.all([runChart(WIDE, chart), runChart(NARROW, chart)]);
      if (wide.status !== 200 || narrow.status !== 200) {
        fail(`expected both reads to succeed, got ${wide.status} and ${narrow.status}`);
      }
      const dim = 'sales.country';
      const wideRows = sorted(rowsOf(wide).map((r) => r[dim]));
      const narrowRows = sorted(rowsOf(narrow).map((r) => r[dim]));
      // Non-empty on purpose. "The restricted user saw nothing" would also be a
      // difference, and it would prove default-deny rather than filtering -- a policy
      // that accidentally matched no rows would sail through a subset assertion alone.
      if (narrowRows.length === 0) fail('the restricted reader saw no rows at all: that is denial, not filtering');
      if (wideRows.length <= narrowRows.length) {
        fail(`expected fewer rows for the restricted reader: ${wideRows.length} vs ${narrowRows.length}`);
      }
      const escaped = narrowRows.filter((r) => !wideRows.includes(r));
      if (escaped.length > 0) fail(`the restricted reader saw rows the wide reader did not: ${escaped.join(', ')}`);
    },
  },
  {
    id: 'different-number',
    why: 'the KPI a person would quote differs between the two readers',
    disabledBy: 'unfiltered-policy',
    run: async () => {
      const chart = (await chartsFor(WIDE)).get(KPI_CHART);
      if (chart === undefined) fail(`chart '${KPI_CHART}' is missing`);
      const [wide, narrow] = await Promise.all([runChart(WIDE, chart), runChart(NARROW, chart)]);
      const value = (r: Reply): number => Number(Object.values(rowsOf(r)[0] ?? {})[0]);
      const [a, b] = [value(wide), value(narrow)];
      if (!Number.isFinite(a) || !Number.isFinite(b)) fail(`expected a number from both readers, got ${a} and ${b}`);
      if (a === b) fail(`both readers got the same total (${a}): the row filter did not reach the number`);
      if (b >= a) fail(`the restricted reader's total (${b}) is not smaller than the wide reader's (${a})`);
    },
  },
  {
    id: 'different-sql',
    why: 'the predicate is in the generated SQL, so it was applied during query construction and not after (FR-SEC-04)',
    disabledBy: 'unfiltered-policy',
    run: async () => {
      const chart = (await chartsFor(WIDE)).get(ROWS_CHART);
      if (chart === undefined) fail(`chart '${ROWS_CHART}' is missing`);
      const [wide, narrow] = await Promise.all([runChart(WIDE, chart), runChart(NARROW, chart)]);
      const [sqlWide, sqlNarrow] = [sqlOf(wide), sqlOf(narrow)];
      if (sqlWide === '' || sqlNarrow === '') fail('no SQL was returned: FR-CON-02 cannot show how this was calculated');
      if (sqlWide === sqlNarrow) fail('one SQL statement served both readers: the context did not reach compilation');
      // Name the mechanism rather than settling for "the strings differ", which a
      // whitespace change would satisfy: the restricted reader's statement filters on
      // the column the reviewed policy names, and the wide reader's does not mention it.
      //
      // The VALUE is not asserted because it is not there to assert. Cube returns the
      // statement parameterised -- `sales_territory_group = ?` -- with 'Europe' in the
      // bound parameters, which `cubeSql` drops. Matching a literal would have passed
      // today only by accident and would break the day the planner binds one more value.
      const column = 'sales_territory_group';
      const predicate = new RegExp(`WHERE[^\\n]*${column}`);
      if (!predicate.test(sqlNarrow)) fail(`the restricted SQL has no WHERE on ${column}:\n${sqlNarrow}`);
      if (sqlWide.includes(column)) fail(`the wide reader's SQL is filtered on ${column} and should not be:\n${sqlWide}`);
    },
  },
  {
    id: 'no-principal',
    why: 'a request whose principal resolves to no tenant is refused before any SQL is built (FR-SEM-14)',
    run: async () => {
      const chart = (await chartsFor(WIDE)).get(KPI_CHART);
      if (chart === undefined) fail(`chart '${KPI_CHART}' is missing`);

      for (const [label, subject] of [['an unknown subject', STRANGER], ['no subject at all', undefined]] as const) {
        const { result, calls } = await withEngineCallCount(() => runChart(subject, chart));
        if (result.status !== 403) fail(`${label}: expected 403, got ${result.status} ${JSON.stringify(result.body)}`);
        if (calls !== 0) fail(`${label}: the engine was called ${calls} time(s) before the request was refused`);
        if (result.body['code'] !== 'unresolved_principal') fail(`${label}: unexpected body ${JSON.stringify(result.body)}`);
        if ('rows' in result.body || 'sql' in result.body) fail(`${label}: the refusal carried data`);
      }

      // The control for this check, in-process: with no directory configured there are
      // no identities, the same request is served, and the engine IS called. Without
      // this, a route that refused everything -- or an engine that was simply
      // unreachable -- would satisfy the assertions above and prove nothing.
      const directory = process.env[DIRECTORY_ENV];
      delete process.env[DIRECTORY_ENV];
      try {
        const { result, calls } = await withEngineCallCount(() => runChart(STRANGER, chart));
        if (result.status !== 200) fail(`control: the same request should be served with no directory, got ${result.status}`);
        if (calls === 0) fail('control: the served request never reached the engine, so the 403 above proved nothing');
      } finally {
        if (directory !== undefined) process.env[DIRECTORY_ENV] = directory;
      }
    },
  },
];

const controlArg = process.argv.find((a) => a.startsWith('--negative-control'));
const control = controlArg?.split('=')[1] as ControlLabel | undefined;
if (controlArg !== undefined && control === undefined) {
  console.error('usage: rls-two-users.ts [--negative-control=<label>]');
  process.exit(2);
}

const failures: string[] = [];
const crashes: string[] = [];

for (const check of CHECKS) {
  try {
    await check.run();
    if (control === undefined) console.log(`  pass  ${check.id.padEnd(28)} ${check.why}`);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof CheckFailed) {
      failures.push(`  ${check.id.padEnd(28)} ${check.why}\n      ${message}`);
    } else {
      crashes.push(`  ${check.id.padEnd(28)} ${message}`);
    }
    if (control === undefined) console.log(`  FAIL  ${check.id.padEnd(28)} ${message}`);
  }
}

await app.close();

if (control !== undefined) {
  // Inverted verdict: with the mechanism disabled, the checks that depend on it MUST
  // fail. A control that merely "did not pass" because the stack was unreachable would
  // be indistinguishable from a working one, so a crash is not counted as a failure.
  const expected = CHECKS.filter((c) => c.disabledBy === control);
  const fired = expected.filter((c) => failures.some((f) => f.startsWith(`  ${c.id.padEnd(28)}`)));
  console.log(`\n${fired.length}/${expected.length} check(s) failed under control '${control}', as they must:`);
  for (const f of failures) console.log(f);
  if (crashes.length > 0) console.log(`\ncrashed (not counted as evidence):\n${crashes.join('\n')}`);
  if (fired.length !== expected.length) {
    const missed = expected.filter((c) => !fired.includes(c)).map((c) => c.id);
    console.error(`\nNEGATIVE CONTROL FAILED: ${missed.join(', ')} still passed with the row filter removed.`);
    console.error('The suite is not testing row-level security -- it is testing nothing.');
    process.exit(1);
  }
  // The other half of the control's claim: the checks the mutation does NOT touch must
  // still pass. Without this, "three checks failed" would be equally consistent with the
  // control working and with the stack having fallen over, and those need different
  // fixes.
  const collateral = CHECKS.filter(
    (c) => c.disabledBy !== control && failures.some((f) => f.startsWith(`  ${c.id.padEnd(28)}`)),
  ).map((c) => c.id);
  if (collateral.length > 0 || crashes.length > 0) {
    console.error(`\nNEGATIVE CONTROL INCONCLUSIVE: ${[...collateral, ...crashes].join(', ')} broke for another reason.`);
    process.exit(1);
  }
  console.log(`\nNEGATIVE CONTROL OK.`);
  process.exit(0);
}

console.log(`\n${CHECKS.length - failures.length - crashes.length}/${CHECKS.length} checks pass`);
if (failures.length > 0) console.log(`\nfailures:\n${failures.join('\n')}`);
if (crashes.length > 0) console.log(`\nerrors:\n${crashes.join('\n')}`);
process.exit(failures.length + crashes.length === 0 ? 0 : 1);
