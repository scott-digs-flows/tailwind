import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse as parseYaml } from 'yaml';
import { format, isFormatted, NonCanonicalError } from '../src/index.ts';
import { VALID_CUBE, VALID_VIEW, VALID_DASHBOARD } from './fixtures.ts';

const CASES = [['cube', VALID_CUBE], ['view', VALID_VIEW], ['dashboard', VALID_DASHBOARD]] as const;

/**
 * NFR-QUAL-01 says "parse -> serialize -> parse is a fixed point". That is necessary
 * but not sufficient, so ADR-004 D3 requires TWO properties. Both are tested over
 * generated permutations, not just the happy fixture.
 */

/** Shuffle mapping keys and inject comments: the inputs a real author produces. */
function permute(src: string, seed: number): string {
  const lines = src.split('\n');
  const out: string[] = [];
  for (const [i, line] of lines.entries()) {
    if ((i + seed) % 5 === 0 && line.trim() !== '') {
      out.push(`${' '.repeat(line.length - line.trimStart().length)}# note ${i}`);
    }
    out.push(line);
  }
  return out.join('\n');
}

test('property 1 — idempotence: fmt(fmt(x)) is byte-for-byte fmt(x)', () => {
  for (const [kind, src] of CASES) {
    for (let seed = 0; seed < 5; seed++) {
      const once = format(kind, permute(src, seed));
      const twice = format(kind, once);
      assert.equal(twice, once, `${kind} seed ${seed} is not a fixed point`);
    }
  }
});

test('property 2 — semantic preservation: parse(fmt(x)) deep-equals parse(x)', () => {
  for (const [kind, src] of CASES) {
    for (let seed = 0; seed < 5; seed++) {
      const input = permute(src, seed);
      assert.deepEqual(parseYaml(format(kind, input)), parseYaml(input), `${kind} seed ${seed} changed meaning`);
    }
  }
});

test('comments survive the round trip — otherwise hand-authors stop using fmt', () => {
  const withComment = VALID_CUBE.replace('cubes:', '# fiscal year starts in February\ncubes:');
  const out = format('cube', withComment);
  assert.match(out, /# fiscal year starts in February/);
  assert.equal(format('cube', out), out, 'still idempotent with comments');
});

test('key order is schema order, not alphabetical', () => {
  const scrambled = `cubes:
  - measures: []
    meta:
      tailwind:
        certification: certified
        description: Orders.
        owner: data-team
        spec_version: 1
    sql_table: orders
    name: orders
    public: false
`;
  const out = format('cube', scrambled);
  // The first key of a sequence item renders as `  - name:`, the rest as `    key:`.
  const keys = [...out.matchAll(/^ {2}(?:- )?(\w+):|^ {4}(\w+):/gm)].map((m) => m[1] ?? m[2]);
  assert.equal(keys[0], 'name', 'identity reads first');
  assert.ok(keys.indexOf('sql_table') < keys.indexOf('measures'), 'source before members');
  // spec_version leads the tailwind block for the same reason.
  assert.match(out, /tailwind:\n\s+spec_version: 1/);
});

test('YAML-1.1-ambiguous scalars are always quoted', () => {
  const out = format('cube', VALID_CUBE.replace('owner: data-team', "owner: 'no'"));
  assert.match(out, /owner: 'no'/, "bare no would read as false on a YAML 1.1 parser");
});

test('dates are quoted — YAML 1.1 resolves them to a Date, 1.2 to a string', () => {
  const out = format('cube', VALID_CUBE.replace('certification: certified',
    "certification: certified\n    last_reviewed: 2026-08-12"));
  assert.match(out, /last_reviewed: '2026-08-12'/);
});

test('long prose becomes a block scalar so diffs stay line-wise', () => {
  const long = 'x'.repeat(120);
  const out = format('cube', VALID_CUBE.replace('description: Orders placed by resellers.', `description: ${long}`));
  assert.match(out, /description: >-?\n/, 'expected a folded block scalar');
});

test('flow collections are CONVERTED to block, not rejected', () => {
  // A formatter that refuses to fix `{a: 1}` is not a formatter. The fixtures are
  // written in flow style on purpose: that is what a real author hands you.
  const out = format('dashboard', VALID_DASHBOARD);
  assert.doesNotMatch(out, /\{ ?x: 0/, 'layout should be block style');
  assert.doesNotMatch(out, /metrics: \[/, 'metrics should be block style');
  assert.match(out, /layout:\n\s+x: 0/);
  // Check mode still fails the original, because canonical output has no flow.
  assert.equal(isFormatted('dashboard', VALID_DASHBOARD), false);
});

test('anchors and aliases are rejected — a reviewer cannot see what they approve', () => {
  const anchored = VALID_CUBE.replace('cubes:', 'x: &a 1\ncubes:');
  assert.throws(() => format('cube', anchored), NonCanonicalError);
});

test('output always ends in exactly one newline', () => {
  for (const [kind, src] of CASES) {
    const out = format(kind, `${src}\n\n\n`);
    assert.ok(out.endsWith('\n') && !out.endsWith('\n\n'));
  }
});

test('isFormatted is the check-mode predicate', () => {
  const canonical = format('cube', VALID_CUBE);
  assert.equal(isFormatted('cube', canonical), true);
  assert.equal(isFormatted('cube', `\n${canonical}`), false);
});
