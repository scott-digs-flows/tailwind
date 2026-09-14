import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml, parseDocument } from 'yaml';
import { loadAllSchemas, loadSchema, type SpecKind } from './schemas.ts';

export interface SpecError {
  /** Human-addressed: array ordinals replaced by the member's own name. */
  path: string;
  /** Ajv's verbatim RFC 6901 instance pointer. Machine-addressed — an editor maps this
   *  to a document position, and it survives regardless of what `path` renders. */
  pointer: string;
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

/**
 * Ajv addresses an array element by ORDINAL: `/cubes/0/measures/7/meta/tailwind`.
 * That is correct and useless — an author staring at a cube with a dozen measures has
 * to count them to find the one that is wrong, and counting is exactly the step people
 * get wrong and then edit the wrong member. So the ordinal is replaced with the thing
 * the author actually typed: `/cubes[fact_internet_sales]/measures[internet_sales]/…`.
 *
 * `name` is the identity key everywhere in the profile except dashboard charts, which
 * use `id`. Anything unnamed keeps its ordinal rather than inventing a label.
 *
 * The pointer is still walked verbatim, so this cannot mislabel: if a segment does not
 * resolve, resolution stops and every remaining segment is left as Ajv wrote it.
 *
 * The label is used only when it matches the profile's identifier pattern. That is not
 * fussiness: by construction we are formatting an INVALID document, so `name` may be
 * any string an author typed, and a name containing a newline would let a bad spec
 * forge extra lines in the CLI's output — which a reviewer reads as the gate's verdict.
 * SpecError.pointer keeps Ajv's verbatim instancePath for anything that needs to
 * address the document rather than describe it (FR-SEM-11's in-editor surface).
 */
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
function nameSegments(root: unknown, instancePath: string): string {
  const segments = instancePath.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let node: unknown = root;
  let resolvable = true;
  const out: string[] = [];
  for (const segment of segments) {
    const child = resolvable && node !== null && typeof node === 'object'
      ? (node as Record<string, unknown>)[segment]
      : undefined;
    if (child === undefined) resolvable = false;
    let label = segment;
    if (/^\d+$/.test(segment) && child !== null && typeof child === 'object') {
      const { name, id } = child as { name?: unknown; id?: unknown };
      const identity = typeof name === 'string' ? name : typeof id === 'string' ? id : '';
      if (IDENTIFIER.test(identity)) label = `[${identity}]`;
    }
    // `[x]` indexes rather than descends, so it must not be preceded by a separator.
    out.push(label.startsWith('[') ? label : `/${label}`);
    node = child;
  }
  return out.join('') || '/';
}

function format(root: unknown, errors: ReturnType<Ajv2020['compile']>['errors']): SpecError[] {
  return (errors ?? []).map((e) => ({
    path: nameSegments(root, e.instancePath),
    pointer: e.instancePath === '' ? '/' : e.instancePath,
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
    : { ok: false, errors: format(data, validator.errors ?? []) };
}

/** Parse YAML then validate. The only entry point anything should use. */
export function parseSpec<T = unknown>(kind: SpecKind, source: string): ParseResult<T> {
  // A YAML document with errors must not reach the schema: report the syntax problem instead.
  const doc = parseDocument(source);
  if (doc.errors.length > 0) {
    return { ok: false, errors: doc.errors.map((e) => ({ path: '/', pointer: '/', message: e.message })) };
  }
  let data: unknown;
  try {
    data = parseYaml(source);
  } catch (e: unknown) {
    return { ok: false, errors: [{ path: '/', pointer: '/', message: e instanceof Error ? e.message : String(e) }] };
  }
  const result = validate(kind, data);
  return result.ok ? { ok: true, value: result.value as T } : result;
}

/** Human-readable failure, identical wherever it is printed (FR-SEM-11). */
export function formatErrors(file: string, errors: SpecError[]): string {
  return [`${file}:`, ...errors.map((e) => `  ${e.path}  ${e.message}`)].join('\n');
}
