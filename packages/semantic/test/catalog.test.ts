import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toCatalog } from '../src/catalog.ts';

/**
 * fixtures/engine-meta.json is a RECORDING, not a hand-written guess: the verbatim
 * /meta document from Cube v1.7.18 (the pin in infra/versions.env) serving the reviewed
 * model on the conformance stack, captured 2026-09-14.
 *
 * That matters more than it looks. A hand-written fixture tests the mapping against
 * what we believe the engine emits, which is the same belief the mapping was written
 * from -- it would agree with itself and prove nothing. Re-record it with
 * `packages/semantic/test/manual/ping.ts`'s stack up when the engine pin moves; a
 * shape change is supposed to break this file, because this file is the seam.
 */
const RECORDED: unknown = JSON.parse(
  readFileSync(new URL('./fixtures/engine-meta.json', import.meta.url), 'utf8'),
);

test('the recorded engine document maps onto the certified view surface', () => {
  const { views } = toCatalog(RECORDED);
  assert.deepEqual(
    views.map((v) => v.name),
    ['sales'],
  );
  const sales = views[0];
  assert.equal(sales?.title, 'Sales');
  assert.equal(sales?.certification, 'certified');
  assert.equal(sales?.owner, 'data-team');
});

test('metrics and dimensions come back view-qualified, with FR-SEM-06 metadata', () => {
  const sales = toCatalog(RECORDED).views[0];
  const revenue = sales?.metrics.find((m) => m.member === 'sales.reseller_sales');
  assert.deepEqual(revenue, {
    member: 'sales.reseller_sales',
    title: 'Reseller Sales',
    owner: 'data-team',
    description: 'Reseller sales net sales amount.',
    certification: 'certified',
  });

  const grain = sales?.dimensions.find((d) => d.member === 'sales.reseller_order_date');
  assert.equal(grain?.type, 'time');
  assert.equal(sales?.dimensions.find((d) => d.member === 'sales.region')?.type, 'string');
});

test('no private cube name survives the mapping — FR-SEM-02', () => {
  // The engine's document carries `aliasMember: "fact_reseller_sales.reseller_sales"`
  // on every view member. Cubes are private; a catalogue that hands out the alias hands
  // out a name the caller is not allowed to reference, and an AI prompt containing it
  // will eventually use it. Assert on the serialized catalogue rather than on one field
  // so that a future passthrough anywhere in the shape fails here.
  const raw = JSON.stringify(RECORDED);
  assert.ok(raw.includes('fact_reseller_sales'), 'fixture should still contain the alias, or this proves nothing');
  assert.ok(!JSON.stringify(toCatalog(RECORDED)).includes('fact_reseller_sales'));
});

test('an unrecognised certification is not certified', () => {
  // Missing FR-SEM-06 metadata already fails CI, so absence here means something is
  // wrong upstream. Reading it as certified would launder that into a trust signal.
  const { views } = toCatalog({
    cubes: [
      {
        name: 'sales',
        type: 'view',
        meta: { tailwind: { certification: 'probably-fine' } },
        measures: [{ name: 'sales.revenue' }],
      },
    ],
  });
  assert.equal(views[0]?.certification, undefined);
  assert.equal(views[0]?.metrics[0]?.certification, undefined);
});

test('cubes are filtered out and nameless members are dropped', () => {
  const { views } = toCatalog({
    cubes: [
      { name: 'fact_sales', type: 'cube', measures: [{ name: 'fact_sales.revenue' }] },
      { name: 'sales', type: 'view', measures: [{ name: 'sales.revenue' }, { title: 'orphan' }] },
    ],
  });
  assert.deepEqual(
    views.map((v) => v.name),
    ['sales'],
  );
  assert.deepEqual(
    views[0]?.metrics.map((m) => m.member),
    ['sales.revenue'],
  );
});

test('a malformed document degrades to an empty catalogue rather than throwing', () => {
  // A discovery panel with nothing in it is a bad day; a discovery panel that throws
  // inside a render is a worse one, and neither is a wrong number.
  assert.deepEqual(toCatalog(undefined), { views: [] });
  assert.deepEqual(toCatalog({ cubes: 'not an array' }), { views: [] });
  assert.deepEqual(toCatalog({ cubes: [{ name: 'sales', measures: null, dimensions: 7 }] }).views[0]?.metrics, []);
});
