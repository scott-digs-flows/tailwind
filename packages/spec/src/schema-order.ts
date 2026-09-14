import { loadSchema, type SpecKind } from './schemas.ts';

type Schema = Record<string, unknown>;

const cache = new Map<SpecKind, Schema>();
function root(kind: SpecKind): Schema {
  let s = cache.get(kind);
  if (s === undefined) {
    s = loadSchema(kind);
    cache.set(kind, s);
  }
  return s;
}

/** Resolve `#/$defs/x` and `https://…/cube.json#/$defs/meta` against the loaded schemas. */
function deref(schema: Schema, kind: SpecKind): Schema {
  const ref = schema['$ref'];
  if (typeof ref !== 'string') return schema;

  const [docPart, pointer] = ref.split('#');
  let doc: Schema = root(kind);
  if (docPart !== undefined && docPart !== '') {
    const name = /\/v1\/([a-z]+)\.json$/.exec(docPart)?.[1];
    if (name === 'cube' || name === 'view' || name === 'dashboard') doc = root(name);
  }
  let node: unknown = doc;
  for (const seg of (pointer ?? '').split('/').filter((s) => s !== '')) {
    node = (node as Schema)?.[seg.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return deref((node as Schema) ?? {}, kind);
}

/**
 * The schema subtree at a document path. Paths are alternating keys and array
 * indices, e.g. ['cubes', 0, 'measures', 0].
 */
function at(kind: SpecKind, path: (string | number)[]): Schema | null {
  let node: Schema = deref(root(kind), kind);
  for (const seg of path) {
    if (typeof seg === 'number') {
      const items = node['items'];
      if (items === undefined) return null;
      node = deref(items as Schema, kind);
    } else {
      const props = node['properties'] as Record<string, Schema> | undefined;
      const next = props?.[seg];
      if (next === undefined) return null;
      node = deref(next, kind);
    }
  }
  return node;
}

/**
 * ADR-004 D3: key order is SCHEMA-declared order, not alphabetical. Alphabetical is
 * deterministic but scrambles meaning; schema order is deterministic *and* readable,
 * and it is stable because the schema is versioned.
 *
 * `name` and `meta` are pulled to the front so every object reads identity-first.
 */
export function keyOrder(kind: SpecKind, path: (string | number)[]): string[] {
  const schema = at(kind, path);
  const props = schema?.['properties'] as Record<string, unknown> | undefined;
  if (props === undefined) return [];
  const declared = Object.keys(props);
  const first = ['spec_version', 'name', 'id'].filter((k) => declared.includes(k));
  const rest = declared.filter((k) => !first.includes(k));
  return [...first, ...rest];
}
