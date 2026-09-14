import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_DIR = join(HERE, '..', 'schemas', 'v1');

/** The spec kinds the profile permits. The FILE EXTENSION carries the type (ADR-004 D1), so a
 *  schema is attached by glob and neither the CLI nor the editor has to guess. */
export const SPEC_KINDS = ['cube', 'view', 'dashboard'] as const;
export type SpecKind = (typeof SPEC_KINDS)[number];

/** `revenue.view.yml` -> `view`. Returns null for anything outside the profile. */
export function kindFromFilename(filename: string): SpecKind | null {
  const m = /\.([a-z]+)\.ya?ml$/.exec(filename);
  const kind = m?.[1];
  return SPEC_KINDS.includes(kind as SpecKind) ? (kind as SpecKind) : null;
}

export function loadSchema(kind: SpecKind): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, `${kind}.json`), 'utf8')) as Record<string, unknown>;
}

export function loadAllSchemas(): Record<string, unknown>[] {
  return readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(SCHEMA_DIR, f), 'utf8')) as Record<string, unknown>);
}

/**
 * ADR-004 D2 containment measure 1: the Cube version is pinned in ONE place
 * (infra/versions.env) and stamped into each profile schema. A Cube bump that does
 * not also touch the schemas fails CI.
 */
export function cubeVersionFromSchemas(): string | null {
  for (const s of loadAllSchemas()) {
    const v = s['x-tailwind-cube-version'];
    if (typeof v === 'string') return v;
  }
  return null;
}
