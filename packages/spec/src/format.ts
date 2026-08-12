import { parseDocument, isMap, isSeq, isScalar, isPair, Scalar, type Document, type Node } from 'yaml';
import { keyOrder } from './schema-order.ts';
import type { SpecKind } from './schemas.ts';

/** Constructs the profile bans outright (ADR-004 D3) -- each is legal YAML whose diff
 *  behaviour is bad or whose expansion is non-obvious to a reviewer. */
export class NonCanonicalError extends Error {}

/** YAML 1.1 read these as booleans/null. A reader on an older parser would disagree
 *  with us about the value, so they are always quoted. */
const AMBIGUOUS = new Set([
  'y', 'Y', 'yes', 'Yes', 'YES', 'n', 'N', 'no', 'No', 'NO',
  'true', 'True', 'TRUE', 'false', 'False', 'FALSE',
  'on', 'On', 'ON', 'off', 'Off', 'OFF',
  'null', 'Null', 'NULL', '~', '',
]);

function mustQuote(v: string): boolean {
  if (AMBIGUOUS.has(v)) return true;
  if (/^0\d/.test(v)) return true;                 // leading zero: octal-ish
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)) return true; // numeric-looking string
  if (/^\s|\s$/.test(v)) return true;
  // Dates and timestamps: YAML 1.1 resolves these to a Date, YAML 1.2 to a string.
  // Quoting removes the disagreement rather than relying on which parser reads it.
  if (/^\d{4}-\d{2}-\d{2}([Tt ]|$)/.test(v)) return true;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(v)) return true;  // sexagesimal in YAML 1.1
  return false;
}

const PROSE_KEYS = new Set(['description', 'title', 'notes']);

function reject(doc: Document): void {
  if (doc.errors.length > 0) throw new NonCanonicalError(doc.errors[0]?.message ?? 'invalid YAML');
  // Anchors and aliases expand invisibly; a reviewer cannot see the value they approve.
  const seen = new Set<unknown>();
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    const node = n as { anchor?: string; flow?: boolean; items?: unknown[]; key?: unknown; value?: unknown; type?: string };
    // Anchors and aliases are REJECTED, not rewritten: expanding them changes what the
    // author wrote, and a reviewer cannot see the value they are approving.
    if (typeof node.anchor === 'string') throw new NonCanonicalError('anchors are not permitted');
    if (node.type === 'ALIAS') throw new NonCanonicalError('aliases are not permitted');
    // Flow collections are NOT rejected -- they are converted to block style in
    // normalise(). A formatter that refuses to fix `{a: 1}` is not a formatter; check
    // mode still fails on them, because canonical output never contains any.
    for (const child of node.items ?? []) walk(child);
    if (node.key !== undefined) walk(node.key);
    if (node.value !== undefined) walk(node.value);
  };
  walk(doc.contents);
}

function normalise(node: Node | null, kind: SpecKind, path: (string | number)[]): void {
  if (isMap(node) || isSeq(node)) node.flow = false; // block style only (ADR-004 D3)
  if (isMap(node)) {
    const order = keyOrder(kind, path);
    if (order.length > 0) {
      // Reordering moves Pairs, and comments hang off the Pair, so they travel with
      // their key rather than being orphaned.
      node.items.sort((a, b) => {
        const ka = isScalar(a.key) ? String(a.key.value) : '';
        const kb = isScalar(b.key) ? String(b.key.value) : '';
        const ia = order.indexOf(ka), ib = order.indexOf(kb);
        return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
      });
    }
    for (const pair of node.items) {
      if (!isPair(pair)) continue;
      const key = isScalar(pair.key) ? String(pair.key.value) : '';
      const value = pair.value as Node | null;
      if (isScalar(value) && typeof value.value === 'string') {
        // Long prose becomes a block scalar so prose diffs are line-wise instead of
        // one enormous changed line.
        if (PROSE_KEYS.has(key) && value.value.length > 80) value.type = Scalar.BLOCK_FOLDED;
        else if (mustQuote(value.value)) value.type = Scalar.QUOTE_SINGLE;
        else value.type = Scalar.PLAIN;
      }
      normalise(value, kind, [...path, key]);
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, i) => normalise(item as Node, kind, [...path, i]));
  }
}

/** THE canonical emitter. One implementation, used by the CLI, the API and the AI path. */
export function format(kind: SpecKind, source: string): string {
  const doc = parseDocument(source, { keepSourceTokens: false });
  reject(doc);
  normalise(doc.contents as Node | null, kind, []);
  const out = doc.toString({
    indent: 2,
    lineWidth: 0,          // never fold: folding makes diffs depend on line length
    minContentWidth: 0,
    defaultStringType: Scalar.PLAIN,
    defaultKeyType: Scalar.PLAIN,
    nullStr: 'null',
    singleQuote: true,
  });
  return `${out.replace(/﻿/g, '').replace(/\r\n/g, '\n').replace(/\n+$/, '')}\n`;
}

export function isFormatted(kind: SpecKind, source: string): boolean {
  try {
    return format(kind, source) === source;
  } catch {
    return false;
  }
}
