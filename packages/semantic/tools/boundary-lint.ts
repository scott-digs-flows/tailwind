/**
 * TW-170. The dependency-boundary check ADR-006 D4 says enforces "one door", and which
 * until now did not exist.
 *
 * The architect's assessment when this was written: the facade is thin and ADR-003's
 * reversibility claim holds -- but "by luck rather than by construction, because the
 * lint is missing." Binding constraint 2 (every number flows through the semantic
 * compiler) and ADR-003's swappability were both being held by people remembering. This
 * turns them into a build failure.
 *
 * Two rules, from ADR-006 D4:
 *
 *   1. `packages/semantic` is the only module in the repository that may import the
 *      engine client or a warehouse driver.
 *   2. Its public exports contain no function that omits `SecurityContext`, and no type
 *      whose name or shape is the vendor's.
 *
 * Rule 2 is answered with the TypeScript checker rather than a regex over the source,
 * because the question is what the SIGNATURES are, not what the text looks like. A
 * textual check would pass on `export const runQuery: Runner = ...` and that is the
 * shape of a lint that tests nothing.
 *
 * It lives in `packages/semantic` on purpose: the door owns its own doorframe, and the
 * check ships and breaks with the thing it protects.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export interface BoundaryFinding {
  file: string;
  rule: string;
  message: string;
}

/** The module we are protecting. Paths are repo-relative and POSIX-style throughout. */
const FACADE = 'packages/semantic';

/**
 * Engine clients and warehouse drivers. Nothing outside the facade may import any of
 * these, with no exception list -- an exception here IS the second door.
 *
 * Deliberately not only Cube: the point of ADR-003's facade is that the engine is
 * replaceable, and a lint that names only today's vendor would go quiet on the day we
 * replaced it. A package that can open a connection to the warehouse belongs behind the
 * door whatever its name.
 */
const WAREHOUSE_DRIVERS = [
  /^@cubejs-(client|backend)\b/,
  /^@clickhouse\/client/,
  /^clickhouse\b/,
  /^duckdb\b/,
  /^@duckdb\//,
  /^snowflake-sdk$/,
  /^@google-cloud\/bigquery$/,
  /^@databricks\/sql$/,
  /^(trino|presto)-client$/,
  /^mysql2?$/,
  /^better-sqlite3$/,
];

/**
 * Drivers for the OPERATIONAL store. These are a different question from the warehouse
 * ones above, and collapsing them would have made this lint unlandable.
 *
 * ADR-006 D4 says "a database driver" without qualification, but Postgres and Redis are
 * how the API holds its own runtime state -- audit log, drafts, sessions -- and
 * 07-domain-model.md section 2 is explicit that this state exists and that NOTHING in it
 * may change a number. So they are permitted, per file, by an allowlist: adding one is a
 * visible diff a reviewer has to agree to, which is the enforcement. A blanket ban would
 * have been deleted within a week, and a deleted lint protects nothing.
 */
const OPERATIONAL_DRIVERS = [/^pg$/, /^pg-/, /^redis$/, /^ioredis$/];

const OPERATIONAL_DRIVER_ALLOWLIST = new Map<string, string>([
  ['apps/api/src/db.ts', 'owns the operational Postgres and Redis connections (07-domain-model.md section 2)'],
  ['apps/api/src/tenancy-guard.ts', 'inspects the operational schema for the ADR-014 backstop (T-130)'],
]);

/**
 * JavaScript is scanned as well as TypeScript. The repo is TypeScript end to end
 * (ADR-006) and the spec lint already refuses a `.js` under `content/`, so this should
 * find nothing -- but "we do not write JavaScript here" is a convention, and a lint that
 * only reads the files the convention covers is a lint with a documented way around it.
 * `infra/cube/cube.js` is the one JS file today: engine configuration, mounted into the
 * container, importing nothing.
 */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.claude', 'coverage']);

const posix = (p: string): string => p.split(sep).join('/');

function sourceFiles(root: string, dir = root, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(root, full, out);
    else if (SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf('.')))) out.push(full);
  }
  return out;
}

interface ImportRef {
  specifier: string;
  typeOnly: boolean;
}

/**
 * Every module specifier a file imports, parsed rather than grepped.
 *
 * Type-only imports are recorded as such and then forgiven: `import type pg from 'pg'`
 * erases at compile time and cannot open a socket. Anything else counts, including a
 * value import that today is only used in a type position -- that one is a keystroke
 * away from being called.
 */
function importsOf(file: string): ImportRef[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true);
  const found: ImportRef[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: node.importClause?.isTypeOnly === true,
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      // `export ... from 'x'` is an import that also re-publishes it. Worse, not better.
      found.push({ specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      // A dynamic import is the obvious way around a lint that only reads static ones.
      found.push({ specifier: node.arguments[0].text, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

/** Rule 1: who may import the engine client, and who may import a driver. */
export function checkImportBoundary(root: string): BoundaryFinding[] {
  const findings: BoundaryFinding[] = [];

  for (const absolute of sourceFiles(root)) {
    const file = posix(relative(root, absolute));
    if (file.startsWith(`${FACADE}/`)) continue; // inside the door

    for (const { specifier, typeOnly } of importsOf(absolute)) {
      const resolved = specifier.startsWith('.') ? posix(relative(root, resolve(dirname(absolute), specifier))) : specifier;

      if (WAREHOUSE_DRIVERS.some((rx) => rx.test(specifier))) {
        findings.push({
          file,
          rule: 'engine-client-outside-facade',
          message: `imports '${specifier}': only ${FACADE} may talk to the engine or the warehouse (ADR-006 D4)`,
        });
      }

      // The other way in: reaching past index.ts into the facade's internals, which is
      // how someone gets `cubeLoad` without a SecurityContext-bearing signature.
      if (
        (resolved.startsWith(`${FACADE}/src/`) || specifier.startsWith('@tailwind/semantic/')) &&
        !/\bindex\.ts$/.test(resolved)
      ) {
        findings.push({
          file,
          rule: 'facade-internals-imported',
          message: `imports '${specifier}': ${FACADE} is entered through its index, not through its internals`,
        });
      }

      if (OPERATIONAL_DRIVERS.some((rx) => rx.test(specifier)) && !typeOnly && !OPERATIONAL_DRIVER_ALLOWLIST.has(file)) {
        findings.push({
          file,
          rule: 'operational-driver-unallowed',
          message:
            `imports '${specifier}': the operational store has a small set of owners. ` +
            `Add this file to OPERATIONAL_DRIVER_ALLOWLIST with a reason, or go through one of them`,
        });
      }
    }
  }

  return findings;
}

/**
 * Exported functions that legitimately do not take a security context, each with the
 * reason it is not a hole. Explicit, because a silent exemption is how the guarantee
 * erodes one convenience at a time.
 */
const CONTEXT_FREE_EXPORTS = new Map<string, string>([
  ['resolveSecurityContext', 'produces the context; it cannot require one'],
  ['pocSystemContext', 'produces the POC context; same reason'],
  ['applyRowLimit', 'pure post-processing of rows already returned under a context'],
  // The cache pair. Both take a CacheKey, and `CacheKey` is brand-typed: `cacheKeyFor`
  // is the only way to obtain one and it requires a context, which it folds in as
  // `securityContextDigest`. So the context is not missing from these two, it is
  // already inside their argument -- and enforced by the type system rather than by
  // this list. Re-requiring it here would let a caller pass a context that disagrees
  // with the one in the key, which is worse than not asking.
  ['cacheKeyString', 'formats a CacheKey, which is brand-typed and already carries the context digest'],
  ['cacheLookupFor', 'pairs an already-context-bearing CacheKey with a freshness policy'],
  ['bundleVersion', 'reads the published artifact version from the environment; reaches no query and no row'],
]);

/**
 * Vendor product names that must never appear in the facade's public surface -- not in
 * an export name, not in a parameter or return type, not in the type of a field.
 *
 * `cubeMeta(...): Promise<unknown>` failed this on both counts and was the reason the
 * rule got written: an `unknown` out of a facade is a promise that the caller will cast
 * it back into the vendor's shape, and once the AI context builder and a discovery UI
 * have both done that, ADR-003's engine choice is no longer a day's work to revisit.
 */
const VENDOR_NAMES = /cube|clickhouse|duckdb|snowflake|bigquery|databricks|trino|presto/i;

/**
 * `unknown` and `any` leaving the facade are the same failure as a vendor type with an
 * extra step, so they are rejected in the same rule.
 *
 * "Leaving" means the whole return value, awaited: `Promise<unknown>` is the shape that
 * started this (`cubeMeta`), and `unknown[]` is the same thing wearing brackets. It does
 * NOT mean an `unknown` anywhere inside -- warehouse rows are honestly
 * `Record<string, unknown>`, because a row's shape is the query's, and flagging that
 * would make the rule something a reviewer has to argue with rather than obey.
 */
function returnsUntyped(checker: ts.TypeChecker, signature: ts.Signature): boolean {
  const returned = checker.getAwaitedType(signature.getReturnType()) ?? signature.getReturnType();
  if ((returned.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return true;
  return /^(unknown|any)(\[\])+$/.test(checker.typeToString(returned));
}

function compilerOptionsFor(entry: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(dirname(entry), ts.sys.fileExists);
  const base: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowImportingTsExtensions: true,
    noEmit: true,
    strict: true,
  };
  if (configPath === undefined) return base;
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config ?? {}, ts.sys, dirname(configPath));
  return { ...parsed.options, ...base };
}

/** Rule 2: the shape of what leaves the package. */
export function checkExportSurface(entry: string): BoundaryFinding[] {
  const findings: BoundaryFinding[] = [];
  const program = ts.createProgram([entry], compilerOptionsFor(entry));
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  if (source === undefined) {
    return [{ file: entry, rule: 'entry-unreadable', message: 'could not parse the package entry point' }];
  }
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) {
    return [{ file: entry, rule: 'entry-not-a-module', message: 'the package entry point exports nothing' }];
  }

  const file = entry;
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    const name = symbol.getName();
    const declaration = symbol.declarations?.[0] ?? symbol.getDeclarations()?.[0];
    if (declaration === undefined) continue;

    if (VENDOR_NAMES.test(name)) {
      findings.push({
        file,
        rule: 'vendor-shaped-export',
        message: `'${name}' names the engine vendor; the facade's surface is Tailwind's vocabulary (ADR-003 D2)`,
      });
    }

    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    const signatures = type.getCallSignatures();

    for (const signature of signatures) {
      const rendered = checker.signatureToString(signature, declaration, ts.TypeFormatFlags.NoTruncation);

      if (VENDOR_NAMES.test(rendered)) {
        findings.push({
          file,
          rule: 'vendor-shaped-export',
          message: `'${name}${rendered}' has the vendor's type in its signature`,
        });
      }
      if (returnsUntyped(checker, signature)) {
        findings.push({
          file,
          rule: 'untyped-export',
          message: `'${name}' returns unknown/any; a caller can only use that by casting it into the vendor's shape`,
        });
      }

      const takesContext = signature
        .getParameters()
        .some((p) =>
          /\bSecurityContext\b/.test(
            checker.typeToString(checker.getTypeOfSymbolAtLocation(p, declaration), declaration),
          ),
        );
      if (!takesContext && !CONTEXT_FREE_EXPORTS.has(name)) {
        findings.push({
          file,
          rule: 'export-omits-security-context',
          message:
            `'${name}' takes no SecurityContext. FR-SEM-14 makes it a required, non-optional parameter ` +
            `of query construction; if this function genuinely cannot reach a number, add it to ` +
            `CONTEXT_FREE_EXPORTS with the reason`,
        });
      }
    }

    // Properties of exported types, one level deep: enough to catch a Tailwind-named
    // wrapper around a vendor object, which is the realistic way this leaks.
    if (signatures.length === 0) {
      for (const property of checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol))) {
        const propertyDeclaration = property.declarations?.[0];
        if (propertyDeclaration === undefined) continue;
        const propertyType = checker.typeToString(
          checker.getTypeOfSymbolAtLocation(property, propertyDeclaration),
          propertyDeclaration,
        );
        if (VENDOR_NAMES.test(propertyType) || VENDOR_NAMES.test(property.getName())) {
          findings.push({
            file,
            rule: 'vendor-shaped-export',
            message: `'${name}.${property.getName()}: ${propertyType}' exposes the vendor's shape`,
          });
        }
      }
    }
  }

  return findings;
}

/**
 * The export-surface rules read one file, so the package must have exactly one entry.
 * Without this, adding `"./internals": "./src/cube-client.ts"` to the package's
 * `exports` map would publish the vendor's client past a lint that never looked at it.
 * An importer would still be caught by `facade-internals-imported`, but a door is worth
 * closing at the door.
 */
export function checkPackageEntry(root: string): BoundaryFinding[] {
  const manifest = join(root, FACADE, 'package.json');
  const exported = (JSON.parse(readFileSync(manifest, 'utf8')) as { exports?: unknown }).exports;
  const entries = typeof exported === 'object' && exported !== null ? Object.keys(exported) : ['.'];
  return entries.length === 1 && entries[0] === '.'
    ? []
    : [
        {
          file: `${FACADE}/package.json`,
          rule: 'facade-has-extra-entry-points',
          message: `exports ${entries.join(', ')}: the facade has one entry, and the export-surface rules read it`,
        },
      ];
}

export function checkBoundaries(root: string): BoundaryFinding[] {
  return [
    ...checkImportBoundary(root),
    ...checkPackageEntry(root),
    ...checkExportSurface(join(root, FACADE, 'src', 'index.ts')),
  ];
}

export function formatFindings(findings: BoundaryFinding[]): string {
  return findings.map((f) => `  ${f.file} [${f.rule}] ${f.message}`).join('\n');
}

/** The repository root, found the same way the tooling does: the workspace file. */
export function repoRoot(from: string): string {
  let dir = from;
  for (;;) {
    if (ts.sys.fileExists(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no pnpm-workspace.yaml above ${from}`);
    dir = parent;
  }
}
