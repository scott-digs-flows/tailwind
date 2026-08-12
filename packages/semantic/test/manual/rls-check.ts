/**
 * T-116 / T-117, against a running stack.
 *
 * ADR-003 D4's Validation clause: the M0 check that proves the security context is real
 * rather than decorative. Two users in the SAME tenant, one cache-eligible query, two
 * different row sets and two different cache-key components.
 */
import { runQuery, resolveSecurityContext, securityContextDigest, type SecurityContext } from '../../src/index.ts';

const opts = { url: process.env['CUBE_URL'] ?? 'http://localhost:4000/cubejs-api/v1', apiSecret: 'dev-only-not-a-secret' };
const query = { view: 'sales', metrics: ['sales.revenue'], dimensions: ['sales.region'] };

const ctxFor = (subject: string, groups: string[]): SecurityContext =>
  resolveSecurityContext({ tenant: 'internal', subject, groups });

/** Either a row set, or a refusal. Cube expresses default-deny by REFUSING the member
 *  rather than returning zero rows -- louder than silence, and the better behaviour. */
type Outcome = { kind: 'rows'; regions: string[] } | { kind: 'refused'; why: string };

async function attempt(ctx: SecurityContext): Promise<Outcome> {
  try {
    const r = await runQuery(opts, { ...query }, ctx);
    return { kind: 'rows', regions: r.rows.map((x) => String(x['sales.region'])).sort() };
  } catch (e: unknown) {
    return { kind: 'refused', why: e instanceof Error ? e.message.slice(0, 60) : String(e) };
  }
}

const morgan = ctxFor('morgan', ['analyst']);
const wes = ctxFor('wes', ['west_only']);
const nobody = ctxFor('nobody', ['not_a_group']);

const [a, b, c] = await Promise.all([attempt(morgan), attempt(wes), attempt(nobody)]);
const show = (o: Outcome): string => (o.kind === 'rows' ? o.regions.join(', ') || '(no rows)' : `REFUSED (${o.why})`);

console.log('morgan (analyst)   ', show(a), '| digest', securityContextDigest(morgan));
console.log('wes    (west_only) ', show(b), '| digest', securityContextDigest(wes));
console.log('nobody (no policy) ', show(c), '| digest', securityContextDigest(nobody));

function fail(message: string): never {
  console.error(`\nFAIL: ${message}`);
  process.exit(1);
}

// Narrow first, so the assertions below read as claims rather than type gymnastics.
if (a.kind !== 'rows') fail(`analyst was refused: ${a.why}`);
if (b.kind !== 'rows') fail(`west_only was refused: ${b.why}`);

if (a.regions.length !== 4) fail(`analyst should see every region, saw ${a.regions.join(', ')}`);
if (b.regions.join() !== 'West') fail(`west_only should see only West, saw ${b.regions.join(', ')}`);

// The load-bearing assertion: SAME tenant, DIFFERENT users, DIFFERENT rows. A per-tenant
// context (Cube's COMPILE_CONTEXT) cannot produce this, which is what FR-SEM-15 forbids
// relying on.
if (a.regions.join() === b.regions.join()) {
  fail('two users in one tenant saw the same rows: the predicate is per tenant, not per request (FR-SEM-15)');
}
if (c.kind === 'rows' && c.regions.length > 0) {
  fail('a context matching NO policy was served rows: default-deny is not working (ADR-003 D4)');
}
if (securityContextDigest(morgan) === securityContextDigest(wes)) fail('two contexts share a cache key');

console.log('\nPASS: per-request predicates (FR-SEM-15), default-deny holds (ADR-003 D4), distinct cache keys (ADR-008).');
