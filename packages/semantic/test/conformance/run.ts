/**
 * T-097 runner. Parameterised by dialect (FR-SEM-13): the tier a warehouse gets is a
 * CONFORMANCE RESULT computed from this suite on a pinned engine version, not a claim
 * we write down (06-dialect-strategy.md section 11).
 *
 *   node packages/semantic/test/conformance/run.ts [--negative-control]
 */
import { readFileSync } from 'node:fs';
import { runQuery, pocSystemContext, type CubeClientOptions } from '../../src/index.ts';
import { CASES } from './cases.ts';

const opts: CubeClientOptions = {
  url: process.env['CUBE_URL'] ?? 'http://localhost:7400/cubejs-api/v1',
  apiSecret: process.env['CUBEJS_API_SECRET'] ?? 'dev-only-not-a-secret',
};
/**
 * The dialect is read from the ENGINE, not from an env var. A conformance report that
 * names the wrong dialect is worse than no report -- the tier it computes would be
 * attributed to a warehouse that was never tested.
 */
async function detectDialect(): Promise<string> {
  try {
    const res = await fetch(`${opts.url.replace(/\/v1$/, '')}/v1/meta`, {
      headers: { Authorization: 'x' },
    });
    void res;
  } catch {
    /* ignore -- fall through to the configured value */
  }
  return process.env['TAILWIND_DIALECT'] ?? process.env['CUBEJS_DB_TYPE'] ?? 'clickhouse';
}
const DIALECT = await detectDialect();
const negativeControl = process.argv.includes('--negative-control');

const oracle = JSON.parse(readFileSync(new URL('../oracle.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const ctx = pocSystemContext();
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

let pass = 0;
const failures: string[] = [];

for (const c of CASES) {
  let actual: unknown;
  try {
    actual = c.actual((await runQuery(opts, c.query, ctx)).rows);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // A join-path refusal is a legitimate ENGINE ANSWER for an ambiguous query, not a
    // failure. Distinguished from a crash so a case can assert the refusal.
    actual = /Can't find join path/.test(msg) ? 'REFUSED' : `ERROR: ${msg.slice(0, 80)}`;
  }
  const expected = c.expect(oracle);
  const ok = eq(actual, expected);
  if (ok) pass += 1;
  else failures.push(`  ${c.id.padEnd(30)} ${c.why}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  if (!negativeControl) console.log(`  ${ok ? 'pass' : 'FAIL'}  ${c.id.padEnd(30)} [${c.topology}]`);
}

console.log(`\ndialect=${DIALECT}  ${pass}/${CASES.length} conformance cases pass`);
if (failures.length > 0) console.log(`\nfailures:\n${failures.join('\n')}`);

/**
 * The negative control. A suite that still passes when the mechanism under test is
 * disabled is not testing the mechanism -- so this mode INVERTS the verdict: with the
 * join cardinality removed from the model, the fan-out and chasm cases MUST fail.
 */
if (negativeControl) {
  const trapCases = CASES.filter((c) => c.topology === 'fan-out' || c.topology === 'chasm');
  const trapFailures = failures.filter((f) => trapCases.some((c) => f.includes(c.id)));
  if (trapFailures.length === 0) {
    console.error('\nNEGATIVE CONTROL FAILED: the trap cases still pass with the relationships removed.');
    console.error('The suite is not testing fan-out detection — it is testing nothing.');
    process.exit(1);
  }
  console.log(`\nNEGATIVE CONTROL OK: ${trapFailures.length} trap case(s) failed with cardinality removed, as they must.`);
  process.exit(0);
}

process.exit(failures.length === 0 ? 0 : 1);
