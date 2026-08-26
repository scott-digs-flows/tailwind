import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml, parseDocument } from 'yaml';
import { loadAllSchemas, loadSchema, type SpecKind } from './schemas.ts';

export interface SpecError {
  path: string;
  message: string;
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: SpecError[] };

/**
 * ONE validator instance, shared by the app, the CLI and CI (FR-SEM-11) -- that
 * sharing is the whole point of T-012. `strict` catches schema authoring mistakes
 * (a typo'd keyword silently validating nothing) as loudly as it catches spec ones.
 */
function buildAjv(): Ajv2020 {
  const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: false });
  addFormats.default(ajv);
  // Declared, not disabled: strict mode must keep catching real typos, so the one
  // annotation we author ourselves is registered rather than switching strict off.
  ajv.addVocabulary(['x-tailwind-cube-version']);
  for (const schema of loadAllSchemas()) ajv.addSchema(schema);
  return ajv;
}

const ajv = buildAjv();

function format(errors: ReturnType<Ajv2020['compile']>['errors']): SpecError[] {
  return (errors ?? []).map((e) => ({
    path: e.instancePath === '' ? '/' : e.instancePath,
    // additionalProperties is the profile's teeth (ADR-004 D2): name the offending key.
    message:
      e.keyword === 'additionalProperties'
        ? `unknown key '${String((e.params as { additionalProperty?: string }).additionalProperty)}' — not permitted by the Tailwind profile`
        : `${e.message ?? 'invalid'}`,
  }));
}

export function validate(kind: SpecKind, data: unknown): ParseResult<unknown> {
  const schema = loadSchema(kind);
  const validator = ajv.getSchema(schema['$id'] as string) ?? ajv.compile(schema);
  return validator(data)
    ? { ok: true, value: data }
    : { ok: false, errors: format(validator.errors ?? []) };
}

/** Parse YAML then validate. The only entry point anything should use. */
export function parseSpec<T = unknown>(kind: SpecKind, source: string): ParseResult<T> {
  // A YAML document with errors must not reach the schema: report the syntax problem instead.
  const doc = parseDocument(source);
  if (doc.errors.length > 0) {
    return { ok: false, errors: doc.errors.map((e) => ({ path: '/', message: e.message })) };
  }
  let data: unknown;
  try {
    data = parseYaml(source);
  } catch (e: unknown) {
    return { ok: false, errors: [{ path: '/', message: e instanceof Error ? e.message : String(e) }] };
  }
  const result = validate(kind, data);
  return result.ok ? { ok: true, value: result.value as T } : result;
}

/** Human-readable failure, identical wherever it is printed (FR-SEM-11). */
export function formatErrors(file: string, errors: SpecError[]): string {
  return [`${file}:`, ...errors.map((e) => `  ${e.path}  ${e.message}`)].join('\n');
}
