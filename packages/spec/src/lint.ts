import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { kindFromFilename } from './schemas.ts';

export interface Finding {
  file: string;
  rule: string;
  message: string;
}

/**
 * Checks that a per-file JSON Schema structurally cannot make.
 *
 * Three kinds live here: rules about the FILE SET (a stray .js in the model directory),
 * rules about Cube behaviour our mirror cannot express, and rules that need cross-file
 * context. Both spec bugs found on 2026-08-12 were in the hand-written mirror of an
 * unpublished schema and surfaced only when a real engine parsed a real file --
 * this is the cheap half of the standing answer, T-097's conformance suite is the rest.
 */

/** ADR-003 D2: YAML only. JS and templating defeat determinism, defeat static
 *  validation, and give AI-generated content a code-execution surface. */
const EXECUTABLE = new Set(['.js', '.mjs', '.cjs', '.ts', '.py', '.jinja', '.j2']);

/** Cloud-gated or Cloud-reserved. ADR-003 D1a: no Cloud feature may become load-bearing,
 *  and the failure mode is gradual -- one convenient key, then self-hosting is gone. */
const CLOUD_ONLY: Record<string, string> = {
  userAttributes: 'Cloud-only; Cube Core exposes securityContext instead',
  ai_context: 'reserved for the Cube Cloud AI agent',
  auto_run: 'Cube Cloud view setting',
  default_ui_filters: 'Cube Cloud view setting',
};

/** With no Cube Store deployed (T-118) a pre-aggregation silently does nothing. */
const REQUIRES_CUBE_STORE = new Set(['pre_aggregations', 'preAggregations']);

/**
 * Which paths CODEOWNERS routes to the data team. ADR-003 D2 permits a raw `sql:`
 * source only in files they own, and FR-GOV-07 makes that routing a PLATFORM property
 * -- so the lint checks the actual CODEOWNERS file rather than assuming a convention.
 * If someone reorganises paths and the routing silently stops matching, raw SQL becomes
 * reviewable by whoever happens to be around. That is the drift this catches.
 */
function dataTeamPatterns(codeownersPath = 'CODEOWNERS'): RegExp[] {
  if (!existsSync(codeownersPath)) return [];
  const out: RegExp[] = [];
  for (const line of readFileSync(codeownersPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const [pattern, ...owners] = trimmed.split(/\s+/);
    if (pattern === undefined || !owners.some((o) => /data-team/.test(o))) continue;
    const rx = pattern
      .replace(/^\//, '')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '.*');
    out.push(new RegExp(`^${rx}`));
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Recursively find offending keys, reporting the path so the message is actionable. */
function scanKeys(node: unknown, path: string, add: (rule: string, msg: string) => void): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => scanKeys(v, `${path}[${i}]`, add));
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const here = path === '' ? key : `${path}.${key}`;
    const cloud = CLOUD_ONLY[key];
    if (cloud !== undefined) add('cloud-gated', `${here}: ${cloud} (ADR-003 D1a)`);
    if (REQUIRES_CUBE_STORE.has(key)) {
      add('needs-cube-store', `${here}: pre-aggregations need Cube Store, which we do not deploy (T-118)`);
    }
    if (typeof value === 'string') {
      if (/\{\{|\{%/.test(value)) add('templating', `${here}: templating is not permitted (ADR-003 D2)`);
      // Cube transpiles meta strings through a Python f-string, so a bare brace is read
      // as a member reference and breaks compilation. Descriptions are exactly what the
      // AI grounds on (FR-AI-05), so this bites the highest-value field.
      if (/\.meta\./.test(here) && /[{}]/.test(value)) {
        add('brace-in-meta', `${here}: braces in meta are interpreted by Cube as member references; escape them`);
      }
    }
    scanKeys(value, here, add);
  }
}

interface MetricSite {
  name: string;
  file: string;
  where: string;
}

/**
 * T-102 / FR-SEM-02, which `08-poc-scope.md` calls non-deferrable: a metric is defined
 * exactly ONCE, bundle-wide.
 *
 * ADR-003 D2 is explicit that this guarantee is ours, not Cube's. Cube lets a measure
 * defined on a cube be surfaced through any number of views -- the right factoring, but
 * it does nothing to stop two differently-defined measures sharing a business name.
 * Two `revenue`s that disagree is the failure the whole product exists to prevent, and
 * it cannot be caught one file at a time.
 */
function singleDefinition(files: { file: string; doc: unknown }[]): Finding[] {
  const sites: MetricSite[] = [];
  for (const { file, doc } of files) {
    for (const cube of ((doc as { cubes?: { name?: string; measures?: { name?: string }[] }[] }).cubes ?? [])) {
      for (const m of cube.measures ?? []) {
        if (typeof m.name === 'string') sites.push({ name: m.name, file, where: `cube '${cube.name ?? '?'}'` });
      }
    }
  }
  const byName = new Map<string, MetricSite[]>();
  for (const s of sites) byName.set(s.name, [...(byName.get(s.name) ?? []), s]);

  const findings: Finding[] = [];
  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    for (const s of group) {
      const others = group.filter((g) => g !== s).map((g) => `${g.file} (${g.where})`);
      findings.push({
        file: s.file,
        rule: 'duplicate-metric',
        message: `metric '${name}' is also defined in ${others.join(', ')}; a metric is defined exactly once bundle-wide (FR-SEM-02)`,
      });
    }
  }
  return findings;
}

export function lintBundle(root: string, codeownersPath = 'CODEOWNERS'): Finding[] {
  const findings: Finding[] = [];
  const ownedByDataTeam = dataTeamPatterns(codeownersPath);
  // CODEOWNERS patterns are REPO-ROOT relative, so they must be matched against a
  // repo-root-relative path -- not one relative to wherever the CLI happens to run.
  const repoRoot = resolve(dirname(codeownersPath));
  const parsedCubes: { file: string; doc: unknown }[] = [];
  let files: string[];
  try {
    files = walk(root);
  } catch {
    return findings;
  }

  for (const file of files) {
    const shown = relative(process.cwd(), file);
    const add = (rule: string, message: string): void => {
      findings.push({ file: shown, rule, message });
    };
    const inSemantic = file.split(sep).includes('semantic');

    if (EXECUTABLE.has(extname(file))) {
      add('no-code', 'executable model files are not permitted; the profile is YAML only (ADR-003 D2)');
      continue;
    }
    const kind = kindFromFilename(file);
    if (kind === null) {
      // A stray file in the reviewed tree is either dead or an escape hatch. Both are
      // worth surfacing. Markdown is neither -- authors need somewhere to explain a
      // model, and content/README.md is the guide for this directory. Deliberately
      // NOT .txt: a stray notes.txt is exactly the scratch file this rule is for.
      const documentation = file.endsWith('.md') || file.endsWith('.gitkeep');
      if (!documentation) {
        add('unknown-file', 'not a recognised spec kind (expected *.cube.yml, *.view.yml, *.dashboard.yml)');
      }
      continue;
    }

    let doc: unknown;
    try {
      doc = parseYaml(readFileSync(file, 'utf8'));
    } catch {
      continue; // parseSpec reports syntax errors; do not double-report here.
    }
    scanKeys(doc, '', add);
    if (kind === 'cube') parsedCubes.push({ file: shown, doc });

    // ADR-003 D2: sql_table is preferred; a raw `sql:` source is permitted only in
    // files the data team owns. CODEOWNERS is the mechanism, so this is a flag for a
    // reviewer rather than a hard failure.
    if (kind === 'cube') {
      const normalised = relative(repoRoot, resolve(file)).split(sep).join('/');
      const routed = ownedByDataTeam.some((rx) => rx.test(normalised));
      for (const cube of ((doc as { cubes?: { name?: string; sql?: string }[] }).cubes ?? [])) {
        if (typeof cube.sql === 'string' && !routed) {
          add('raw-sql', `cube '${cube.name ?? '?'}' uses a raw sql source but CODEOWNERS does not route this path to the data team (ADR-003 D2)`);
        }
      }
    }
    void inSemantic;
  }
  findings.push(...singleDefinition(parsedCubes));
  return findings;
}

export function formatFindings(findings: Finding[]): string {
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  return [...byFile.entries()]
    .map(([file, fs]) => [`  ${file}:`, ...fs.map((f) => `    [${f.rule}] ${f.message}`)].join('\n'))
    .join('\n');
}
