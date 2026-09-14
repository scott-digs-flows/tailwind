import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec, loadSchema } from '../src/index.ts';
import {
  VALID_CUBE, VALID_VIEW, VALID_DASHBOARD, REQUIRED_META_FIELDS, meta, without,
} from './fixtures.ts';

/**
 * FR-SEM-06, whose own words are "Missing metadata fails CI" — T-019 / TW-28.
 *
 * The point of this file is the NEGATIVE controls. A gate that has only ever been
 * shown accepting good input is untested; this repo makes that argument about its own
 * conformance suite (FR-SEM-13) and it applies just as well here. So every test below
 * removes exactly one required field from a fixture that is known to pass, and asserts
 * the removal is what fails. If the `required` list in the schema were emptied, the
 * "conforming specs parse" test in validate.test.ts would still be green and every one
 * of these would go red — which is the property that makes them worth having.
 *
 * Enforcement lives in `schemas/v1/cube.json#/$defs/meta`, which view.json and
 * dashboard.json both `$ref`. One statement of the rule, inherited by every member
 * kind, shared by the app, the CLI and CI (FR-SEM-11).
 */

const errorsFor = (kind: 'cube' | 'view' | 'dashboard', src: string): string => {
  const r = parseSpec(kind, src);
  assert.equal(r.ok, false, 'expected this spec to be rejected');
  return r.ok ? '' : r.errors.map((e) => `${e.path}  ${e.message}`).join('\n');
};

test('the schema requires exactly the four fields FR-SEM-06 names, and no more', () => {
  // ADR-003 D2 enumerates them: owner, description, certification, last_reviewed.
  // `spec_version` is ours (ADR-004's amendment), not FR-SEM-06's. Asserted rather
  // than assumed so that adding a fifth required field is a deliberate act with a
  // failing test attached, not a quiet tightening that breaks every author at once.
  const defs = loadSchema('cube')['$defs'] as Record<string, Record<string, never>>;
  const required = (defs['meta'] as unknown as
    { properties: { tailwind: { required: string[] } } }).properties.tailwind.required;
  assert.deepEqual([...required].sort(), ['certification', 'description', 'last_reviewed', 'owner', 'spec_version']);
});

// The positive control. Without it the negatives below prove only that the parser can
// say no, not that it says no for the right reason.
test('a cube, view and dashboard carrying all four fields are accepted', () => {
  for (const [kind, src] of [['cube', VALID_CUBE], ['view', VALID_VIEW], ['dashboard', VALID_DASHBOARD]] as const) {
    const r = parseSpec(kind, src);
    assert.equal(r.ok, true, `${kind} should parse: ${r.ok ? '' : JSON.stringify(r.errors)}`);
  }
});

for (const field of REQUIRED_META_FIELDS) {
  test(`a model missing meta.tailwind.${field} fails (FR-SEM-06)`, () => {
    // `without` strips the FIRST match, which in VALID_CUBE is the cube's own meta —
    // the "model" half of "every model, dimension, and metric".
    assert.match(errorsFor('cube', without(VALID_CUBE, field)), new RegExp(`must have required property '${field}'`));
  });

  test(`a view missing meta.tailwind.${field} fails — views inherit the rule by $ref`, () => {
    assert.match(errorsFor('view', without(VALID_VIEW, field)), new RegExp(`must have required property '${field}'`));
  });

  test(`a dashboard missing meta.tailwind.${field} fails — same $ref again`, () => {
    assert.match(errorsFor('dashboard', without(VALID_DASHBOARD, field)), new RegExp(`must have required property '${field}'`));
  });
}

/**
 * "Every model, DIMENSION, and METRIC" — the member level is the half that matters
 * most, because it is the level the catalog and the provenance badge render one row
 * at a time. A cube with impeccable metadata and a bare measure is the shape that
 * would quietly reach those surfaces.
 */
const cubeWith = (measureMeta: string, dimensionMeta = meta(8)): string => `cubes:
  - name: orders
    sql_table: orders
    public: false
${meta(4)}
    measures:
      - name: revenue
        type: sum
        sql: amount
${measureMeta}
    dimensions:
      - name: order_date
        sql: order_date
        type: time
${dimensionMeta}
`;

test('a measure with no meta block at all fails, not just one with a short block', () => {
  assert.match(errorsFor('cube', cubeWith('')), /must have required property 'meta'/);
});

test('a dimension with no meta block at all fails for the same reason', () => {
  assert.match(errorsFor('cube', cubeWith(meta(8), '')), /must have required property 'meta'/);
});

for (const field of REQUIRED_META_FIELDS) {
  test(`a metric missing ${field} fails (FR-SEM-06)`, () => {
    assert.match(errorsFor('cube', cubeWith(without(meta(8), field))), new RegExp(`must have required property '${field}'`));
  });

  test(`a dimension missing ${field} fails (FR-SEM-06)`, () => {
    assert.match(errorsFor('cube', cubeWith(meta(8), without(meta(8), field))), new RegExp(`must have required property '${field}'`));
  });
}

/**
 * The message is the feature. Ajv addresses an array element by ordinal, and
 * `/cubes/0/measures/1/meta/tailwind` means an author with a dozen measures counts
 * them by hand — and miscounts, and edits the wrong one. The failure has to name the
 * member the author typed.
 */
test('the failure names the offending member, not its array index', () => {
  const twoMeasures = `cubes:
  - name: fact_internet_sales
    sql_table: raw.fact_internet_sales
    public: false
${meta(4)}
    measures:
      - name: internet_sales
        type: sum
        sql: sales_amount
${meta(8)}
      - name: internet_order_quantity
        type: sum
        sql: order_quantity
${without(meta(8), 'owner')}
`;
  const msg = errorsFor('cube', twoMeasures);
  assert.match(msg, /\/cubes\[fact_internet_sales\]\/measures\[internet_order_quantity\]\/meta\/tailwind/);
  assert.match(msg, /must have required property 'owner'/);
  assert.doesNotMatch(msg, /measures\/1/, 'the ordinal is what we are replacing');
});

test('a dashboard chart is named by its id, which is its identity key', () => {
  const msg = errorsFor('dashboard', VALID_DASHBOARD.replace('type: kpi', 'type: sankey'));
  assert.match(msg, /\/charts\[revenue_kpi\]\/type/);
});

test('an unnamed element keeps its ordinal rather than inventing a label', () => {
  // access_policy entries have no `name`. Resolution must degrade to Ajv's pointer
  // instead of guessing, or the pointer stops addressing the document.
  const msg = errorsFor('view', VALID_VIEW.replace('group: "*"', 'group: ""'));
  assert.match(msg, /\/views\[orders\]\/access_policy\/0\/group/);
});

test('a name that is not a profile identifier is not used as a label', () => {
  // We are, by construction, formatting an INVALID document, so `name` can be anything.
  // A newline in it would let a bad spec forge a line of the CLI's own output, which a
  // reviewer reads as the gate's verdict. Non-identifiers fall back to the ordinal.
  const src = VALID_CUBE.replace('name: orders', 'name: "orders\\nFAIL fake.cube.yml: everything is fine"');
  const r = parseSpec('cube', src);
  assert.equal(r.ok, false);
  const paths = r.ok ? [] : r.errors.map((e) => e.path);
  assert.ok(paths.every((p) => !p.includes('\n')), `no forged line in ${JSON.stringify(paths)}`);
  assert.ok(paths.some((p) => p.startsWith('/cubes/0')), 'falls back to the ordinal');
});

test('the machine-readable pointer survives alongside the human path', () => {
  // FR-SEM-11 puts validation in the editor too, and an editor maps an RFC 6901
  // pointer to a document position. `path` is prose; `pointer` is an address.
  const r = parseSpec('cube', without(VALID_CUBE, 'owner'));
  assert.equal(r.ok, false);
  const e = r.ok ? undefined : r.errors[0];
  assert.equal(e?.pointer, '/cubes/0/meta/tailwind');
  assert.equal(e?.path, '/cubes[orders]/meta/tailwind');
});

test('last_reviewed must be a real calendar date, not merely date-shaped', () => {
  // ajv-formats validates the date, so a transposed month is caught here rather than
  // becoming a badge that renders "reviewed 2026-13-01".
  assert.match(errorsFor('cube', VALID_CUBE.replace("last_reviewed: '2026-08-12'", "last_reviewed: '2026-13-01'")), /format "date"/);
});
