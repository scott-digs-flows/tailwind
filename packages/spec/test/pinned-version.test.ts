import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cubeVersionFromSchemas } from '../src/index.ts';

/**
 * ADR-004 D2, containment measure 1: the Cube version lives in exactly ONE place.
 * A Cube bump that does not also touch the profile schemas fails here, which is
 * what stops the mirror silently drifting from the engine it mirrors.
 */
test('schema cube version matches infra/versions.env', () => {
  const env = readFileSync(new URL('../../../infra/versions.env', import.meta.url), 'utf8');
  const pinned = /^CUBE_VERSION=(\S+)/m.exec(env)?.[1];
  assert.ok(pinned, 'CUBE_VERSION not found in infra/versions.env');
  assert.equal(cubeVersionFromSchemas(), pinned);
});
