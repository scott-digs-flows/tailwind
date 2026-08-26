/**
 * Readiness probe that asks the real question: can Cube SERVE a query?
 *
 * /readyz is not sufficient -- T-118 showed it passes while the model is unusable.
 * But a probe that hardcodes a member is worse: it fails whenever the model changes,
 * which is exactly when you are publishing. So the measure is DISCOVERED from the
 * engine's own metadata, making the probe model-independent.
 */
import { cubeMeta, runQuery, pocSystemContext } from '../../src/index.ts';

const opts = {
  url: process.env['CUBE_URL'] ?? 'http://localhost:7400/cubejs-api/v1',
  apiSecret: process.env['CUBEJS_API_SECRET'] ?? 'dev-only-not-a-secret',
};
const ctx = pocSystemContext();

const meta = (await cubeMeta(opts, ctx)) as { cubes?: { name: string; measures?: { name: string }[] }[] };
const first = meta.cubes?.flatMap((c) => c.measures ?? [])[0]?.name;
if (first === undefined) throw new Error('engine exposes no measures: the model did not compile');

const view = first.split('.')[0] ?? '';
await runQuery(opts, { view, metrics: [first] }, ctx);
