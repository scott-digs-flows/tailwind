/**
 * Readiness probe that asks the real question: can the engine SERVE a query?
 *
 * /readyz is not sufficient -- T-118 showed it passes while the model is unusable.
 * But a probe that hardcodes a member is worse: it fails whenever the model changes,
 * which is exactly when you are publishing. So the metric is DISCOVERED from the
 * catalogue, making the probe model-independent.
 *
 * It discovers it through `describeCatalog`, which means CI's readiness step also
 * exercises the metadata mapping against the live pinned engine. The unit test covers
 * the mapping against a recorded document; this covers the recording still being true.
 */
import { describeCatalog, runQuery, pocSystemContext } from '../../src/index.ts';

const ctx = pocSystemContext();

const { views } = await describeCatalog(ctx);
const probe = views.flatMap((v) => v.metrics.map((m) => ({ view: v.name, member: m.member })))[0];
if (probe === undefined) {
  throw new Error(`engine exposes no metrics across ${views.length} view(s): the model did not compile`);
}

await runQuery(ctx, { view: probe.view, metrics: [probe.member] });
