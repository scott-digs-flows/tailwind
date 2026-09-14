import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintBundle } from '../src/index.ts';
import { VALID_CUBE } from './fixtures.ts';

function bundle(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'tw-lint-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}
const rules = (root: string, codeowners?: string): string[] =>
  lintBundle(root, codeowners ?? join(root, 'MISSING')).map((f) => f.rule);

test('a JavaScript model file is rejected — YAML only (ADR-003 D2)', () => {
  const root = bundle({ 'semantic/cubes/orders.js': 'cube("orders", {});' });
  assert.deepEqual(rules(root), ['no-code']);
});

test('a Python or Jinja model file is rejected for the same reason', () => {
  const root = bundle({ 'semantic/globals.py': 'x = 1', 'semantic/t.j2': '{{ x }}' });
  assert.deepEqual(rules(root).sort(), ['no-code', 'no-code']);
});

test('a Cloud-only key is an error — no Cloud feature may become load-bearing (D1a)', () => {
  const root = bundle({
    'semantic/views/s.view.yml': "views:\n  - name: s\n    meta:\n      auto_run: true\n    access_policy:\n      - group: '*'\n        row_level:\n          filters:\n            - member: s.a\n              operator: equals\n              values: ['{ userAttributes.region }']\n",
  });
  const found = rules(root);
  assert.ok(found.includes('cloud-gated'), `expected cloud-gated, got ${found.join(',')}`);
});

test('a pre-aggregation is flagged — we deploy no Cube Store (T-118)', () => {
  const root = bundle({ 'semantic/cubes/o.cube.yml': 'cubes:\n  - name: o\n    pre_aggregations:\n      - name: rollup\n' });
  assert.ok(rules(root).includes('needs-cube-store'));
});

test('braces in meta are flagged — Cube reads them as member references', () => {
  const root = bundle({
    'semantic/cubes/o.cube.yml': 'cubes:\n  - name: o\n    meta:\n      tailwind:\n        description: Revenue {net of returns}\n',
  });
  assert.ok(rules(root).includes('brace-in-meta'),
    'this bites description, which is exactly what the AI grounds on (FR-AI-05)');
});

test('templating is flagged wherever it appears, not just in schema-covered fields', () => {
  const root = bundle({ 'semantic/cubes/o.cube.yml': "cubes:\n  - name: o\n    sql_table: \"{{ tenant }}_orders\"\n" });
  assert.ok(rules(root).includes('templating'));
});

test('a stray file in the reviewed tree is surfaced, not ignored', () => {
  const root = bundle({ 'semantic/notes.txt': 'scratch' });
  assert.deepEqual(rules(root), ['unknown-file']);
});

test('raw sql is permitted when CODEOWNERS routes the path to the data team', () => {
  const root = bundle({
    'content/tenants/internal/semantic/cubes/o.cube.yml': 'cubes:\n  - name: o\n    sql: SELECT 1\n',
    'CODEOWNERS': '/content/tenants/*/semantic/**   @org/data-team\n',
  });
  assert.deepEqual(lintBundle(join(root, 'content'), join(root, 'CODEOWNERS')).map((f) => f.rule), []);
});

test('raw sql is an error when CODEOWNERS does NOT route the path — catches routing drift', () => {
  const root = bundle({
    'content/models/o.cube.yml': 'cubes:\n  - name: o\n    sql: SELECT 1\n',
    'CODEOWNERS': '/content/tenants/*/semantic/**   @org/data-team\n',
  });
  assert.deepEqual(lintBundle(join(root, 'content'), join(root, 'CODEOWNERS')).map((f) => f.rule), ['raw-sql']);
});

test('a conforming cube produces no findings', () => {
  const root = bundle({ 'semantic/cubes/orders.cube.yml': VALID_CUBE });
  assert.deepEqual(rules(root), []);
});

/**
 * FR-SEM-02 / T-102. Cannot be caught one file at a time, which is why it lives in the
 * bundle lint: Cube happily compiles two differently-defined measures sharing a name.
 */
test('the same metric name defined in two cubes is rejected (FR-SEM-02)', () => {
  const root = bundle({
    'semantic/cubes/a.cube.yml': 'cubes:\n  - name: a\n    measures:\n      - name: revenue\n        type: sum\n        sql: amount\n',
    'semantic/cubes/b.cube.yml': 'cubes:\n  - name: b\n    measures:\n      - name: revenue\n        type: sum\n        sql: net_amount\n',
  });
  const found = lintBundle(root, join(root, 'MISSING'));
  const dupes = found.filter((f) => f.rule === 'duplicate-metric');
  assert.equal(dupes.length, 2, 'both definition sites are named, so either can be the one that moves');
  assert.match(dupes[0]?.message ?? '', /'revenue' is also defined in/);
});

test('two metrics defined twice in the SAME file are rejected too', () => {
  const root = bundle({
    'semantic/cubes/a.cube.yml':
      'cubes:\n  - name: a\n    measures:\n      - name: revenue\n        type: sum\n        sql: amount\n  - name: b\n    measures:\n      - name: revenue\n        type: sum\n        sql: other\n',
  });
  assert.equal(lintBundle(root, join(root, 'MISSING')).filter((f) => f.rule === 'duplicate-metric').length, 2);
});

test('distinct metric names across cubes are fine', () => {
  const root = bundle({
    'semantic/cubes/a.cube.yml': 'cubes:\n  - name: a\n    measures:\n      - name: revenue\n        type: sum\n        sql: amount\n',
    'semantic/cubes/b.cube.yml': 'cubes:\n  - name: b\n    measures:\n      - name: cost\n        type: sum\n        sql: cost\n',
  });
  assert.deepEqual(lintBundle(root, join(root, 'MISSING')).filter((f) => f.rule === 'duplicate-metric'), []);
});

test('documentation in the reviewed tree is not a stray file', () => {
  // The rule targets dead files and escape hatches. An author explaining a model, or
  // the authoring guide itself, is neither -- and a lint that fights documentation
  // teaches people to stop writing it.
  const root = bundle({ 'README.md': '# how this model works', 'semantic/cubes/NOTES.md': 'context' });
  assert.deepEqual(lintBundle(root, join(root, 'MISSING')).map((f) => f.rule), [],
    'markdown is documentation; .txt stays flagged, per the stray-file test above');
});
