import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkBoundaries,
  checkExportSurface,
  checkImportBoundary,
  checkPackageEntry,
  repoRoot,
} from '../tools/boundary-lint.ts';

/**
 * Half of these tests are negative controls, and they are the half that matters. A
 * boundary lint that only ever runs over a clean repository reports success whether or
 * not it is looking at anything -- the same failure as a conformance suite that still
 * passes with the mechanism disabled (T-137), and the same failure as ADR-014's tenancy
 * backstop shipping complete and inert (T-130).
 *
 * So each rule gets a fixture that must make it fire.
 */

const ROOT = repoRoot(import.meta.dirname);

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'tw-boundary-'));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return dir;
}

const rules = (findings: { rule: string }[]): string[] => findings.map((f) => f.rule);

test('the repository as it stands passes every rule', () => {
  assert.deepEqual(checkBoundaries(ROOT), []);
});

test('an engine client imported outside the facade fails — ADR-006 D4 validation (3)', () => {
  const dir = fixture({
    'apps/api/src/shortcut.ts': "import { createClient } from '@clickhouse/client';\nexport const c = createClient;\n",
  });
  assert.deepEqual(rules(checkImportBoundary(dir)), ['engine-client-outside-facade']);
});

test('a dynamic import of the engine client fails too', () => {
  // The obvious way around a lint that only reads static imports.
  const dir = fixture({
    'apps/api/src/late.ts': "export const c = async () => (await import('@cubejs-client/core')).default;\n",
  });
  assert.deepEqual(rules(checkImportBoundary(dir)), ['engine-client-outside-facade']);
});

test("reaching past the facade's index into its internals fails", () => {
  const dir = fixture({
    'apps/api/src/sneaky.ts': "import { cubeLoad } from '../../../packages/semantic/src/cube-client.ts';\nexport { cubeLoad };\n",
    'packages/semantic/src/cube-client.ts': 'export const cubeLoad = 1;\n',
  });
  assert.deepEqual(rules(checkImportBoundary(dir)), ['facade-internals-imported']);
});

test('the facade itself may import whatever it needs — it is the door', () => {
  const dir = fixture({
    'packages/semantic/src/cube-client.ts': "import { createClient } from '@clickhouse/client';\nexport const c = createClient;\n",
  });
  assert.deepEqual(checkImportBoundary(dir), []);
});

test('an unallowed operational driver import fails, and a type-only one does not', () => {
  const value = fixture({ 'apps/api/src/rogue.ts': "import pg from 'pg';\nexport const p = pg;\n" });
  assert.deepEqual(rules(checkImportBoundary(value)), ['operational-driver-unallowed']);

  // `import type` erases at compile time and cannot open a socket. The tenancy guard
  // reads the operational schema's TYPES this way and is not a second door.
  const typeOnly = fixture({ 'apps/api/src/typed.ts': "import type pg from 'pg';\nexport type P = pg.Pool;\n" });
  assert.deepEqual(checkImportBoundary(typeOnly), []);
});

test('an export that omits the security context fails — ADR-006 D4 validation (4)', () => {
  const dir = fixture({
    'index.ts': "export function metricsFor(view: string): string[] { return [view]; }\n",
  });
  assert.deepEqual(rules(checkExportSurface(join(dir, 'index.ts'))), ['export-omits-security-context']);
});

test('a vendor-named export fails, and so does a vendor-shaped signature', () => {
  const dir = fixture({
    'index.ts': `
export interface CubeResultSet { data: string[] }
export declare function loadRows(ctx: SecurityContext): Promise<CubeResultSet>;
export interface SecurityContext { tenant: string }
`,
  });
  const found = rules(checkExportSurface(join(dir, 'index.ts')));
  // Once for the name, once for the signature that returns it.
  assert.equal(found.filter((r) => r === 'vendor-shaped-export').length, 2);
});

test('an export returning unknown fails — this is exactly what cubeMeta was', () => {
  const dir = fixture({
    'index.ts': `
export declare function describeModel(ctx: SecurityContext): Promise<unknown>;
export interface SecurityContext { tenant: string }
`,
  });
  assert.deepEqual(rules(checkExportSurface(join(dir, 'index.ts'))), ['untyped-export']);
});

test('a second entry point in the package manifest fails', () => {
  // The export-surface rules read one file. Publishing `./internals` would route the
  // engine client past a lint that never looked at it.
  const dir = fixture({
    'packages/semantic/package.json':
      '{ "exports": { ".": "./src/index.ts", "./internals": "./src/cube-client.ts" } }',
  });
  assert.deepEqual(rules(checkPackageEntry(dir)), ['facade-has-extra-entry-points']);
});

test('a clean surface produces nothing', () => {
  const dir = fixture({
    'index.ts': `
export interface SecurityContext { tenant: string }
export interface ViewDescriptor { name: string }
export declare function describeCatalog(ctx: SecurityContext): Promise<ViewDescriptor[]>;
`,
  });
  assert.deepEqual(checkExportSurface(join(dir, 'index.ts')), []);
});
