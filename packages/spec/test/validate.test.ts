import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec, kindFromFilename, cubeVersionFromSchemas } from '../src/index.ts';
import { VALID_CUBE, VALID_VIEW, VALID_DASHBOARD } from './fixtures.ts';

const fails = (kind: 'cube' | 'view' | 'dashboard', src: string) => {
  const r = parseSpec(kind, src);
  assert.equal(r.ok, false, 'expected this spec to be rejected');
  return r.ok ? '' : r.errors.map((e) => `${e.path} ${e.message}`).join(' | ');
};

test('conforming specs parse', () => {
  for (const [kind, src] of [['cube', VALID_CUBE], ['view', VALID_VIEW], ['dashboard', VALID_DASHBOARD]] as const) {
    const r = parseSpec(kind, src);
    assert.equal(r.ok, true, `${kind} should parse: ${r.ok ? '' : JSON.stringify(r.errors)}`);
  }
});

test('an unknown key is rejected — the profile is a gate, not a style guide', () => {
  const msg = fails('cube', VALID_CUBE.replace('    sql_table: orders', '    sql_table: orders\n    refreshKey: every 5 min'));
  assert.match(msg, /unknown key 'refreshKey'/);
});

test('Jinja templating is rejected (ADR-003 D2)', () => {
  fails('cube', VALID_CUBE.replace('sql_table: orders', 'sql_table: "{{ COMPILE_CONTEXT.tenant }}_orders"'));
});

test('a missing tailwind meta block is rejected (FR-SEM-06)', () => {
  fails('cube', VALID_CUBE.replace(/^ {4}meta:\n(?: {6}.*\n| {8}.*\n| {10}.*\n)+/m, ''));
});

test('an unknown certification state is rejected (FR-SEM-07)', () => {
  fails('cube', VALID_CUBE.replace('certification: certified', 'certification: probably-fine'));
});

test('a public cube is rejected — cubes are private, dashboards see views (FR-SEM-02)', () => {
  fails('cube', VALID_CUBE.replace('public: false', 'public: true'));
});

test('a view without an access_policy is rejected — default-deny (ADR-003 D4)', () => {
  fails('view', VALID_VIEW.replace(/^ {4}access_policy:\n(?: {6}.*\n| {8}.*\n| {10}.*\n)+/m, ''));
});

test('an unknown spec_version is rejected rather than best-effort parsed', () => {
  fails('cube', VALID_CUBE.replace('spec_version: 1', 'spec_version: 2'));
});

test('spec_version is NOT a top-level key on profile files (Cube whitelists those)', () => {
  fails('cube', `spec_version: 1\n${VALID_CUBE}`);
});

test('a dashboard metric must be view-qualified (FR-SEM-02)', () => {
  fails('dashboard', VALID_DASHBOARD.replace('metrics: [orders.revenue]', 'metrics: [revenue]'));
});

test('an unsupported chart type is rejected', () => {
  fails('dashboard', VALID_DASHBOARD.replace('type: kpi', 'type: sankey'));
});

test('a chart wider than the 12-column grid is rejected', () => {
  fails('dashboard', VALID_DASHBOARD.replace('w: 3', 'w: 13'));
});

test('malformed YAML reports a syntax error, not a schema error', () => {
  fails('dashboard', 'spec_version: 1\n  bad: [indent');
});

test('duplicate YAML keys are rejected', () => {
  fails('dashboard', `${VALID_DASHBOARD}\ntitle: Sales Again\n`);
});

test('the file extension carries the type (ADR-004 D1)', () => {
  assert.equal(kindFromFilename('revenue.view.yml'), 'view');
  assert.equal(kindFromFilename('orders.cube.yml'), 'cube');
  assert.equal(kindFromFilename('sales.dashboard.yml'), 'dashboard');
  assert.equal(kindFromFilename('README.md'), null);
});

test('the Cube version is stamped into the schemas (ADR-004 D2 containment)', () => {
  assert.match(cubeVersionFromSchemas() ?? '', /^v\d+\.\d+\.\d+$/);
});
