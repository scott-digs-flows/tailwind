#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { format, formatErrors, formatFindings, isFormatted, kindFromFilename, lintBundle, parseSpec } from '@tailwind/spec';
import { writeFileSync } from 'node:fs';

/**
 * FR-DEV-01. The CLI shares ONE validator with the API and CI (FR-SEM-11) -- the
 * hand-written path is never second-class, and it must not disagree with the app
 * about what is valid.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function validateCommand(root: string): number {
  const files = walk(root).filter((f) => kindFromFilename(f) !== null);
  if (files.length === 0) {
    console.log(`no spec files under ${relative(process.cwd(), root) || root}`);
    return 0;
  }
  let failed = 0;
  for (const file of files) {
    const kind = kindFromFilename(file);
    if (kind === null) continue;
    const result = parseSpec(kind, readFileSync(file, 'utf8'));
    const shown = relative(process.cwd(), file);
    if (result.ok) {
      console.log(`  ok    ${shown}`);
    } else {
      failed += 1;
      console.error(formatErrors(`  FAIL  ${shown}`, result.errors));
    }
  }
  // T-115: checks a per-file schema structurally cannot make -- executable model files,
  // Cloud-gated keys, templating, CODEOWNERS routing drift. One gate, not two commands,
  // so the app, the CLI and CI cannot disagree about what is acceptable (FR-SEM-11).
  const findings = lintBundle(root);
  if (findings.length > 0) {
    console.error(`\nprofile lint:\n${formatFindings(findings)}`);
  }
  const total = failed + findings.length;
  console.log(`\n${files.length - failed}/${files.length} specs valid, ${findings.length} lint finding(s)`);
  return total === 0 ? 0 : 1;
}

/**
 * ADR-004 D3. `fmt` rewrites to canonical form; `fmt --check` fails without writing,
 * which is what CI runs so non-canonical bytes cannot be merged. That check is what
 * makes every subsequent diff in the product's history minimal.
 */
function fmtCommand(root: string, checkOnly: boolean): number {
  const files = walk(root).filter((f) => kindFromFilename(f) !== null);
  let changed = 0;
  for (const file of files) {
    const kind = kindFromFilename(file);
    if (kind === null) continue;
    const source = readFileSync(file, 'utf8');
    const shown = relative(process.cwd(), file);
    try {
      if (checkOnly) {
        if (!isFormatted(kind, source)) {
          changed += 1;
          console.error(`  not canonical  ${shown}`);
        }
      } else {
        const out = format(kind, source);
        if (out !== source) {
          writeFileSync(file, out);
          changed += 1;
          console.log(`  formatted  ${shown}`);
        }
      }
    } catch (e: unknown) {
      changed += 1;
      console.error(`  ERROR  ${shown}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (checkOnly) {
    console.log(changed === 0 ? `${files.length} files canonical` : `\n${changed} file(s) need formatting; run: tailwind fmt`);
    return changed === 0 ? 0 : 1;
  }
  console.log(changed === 0 ? `${files.length} files already canonical` : `\n${changed} file(s) formatted`);
  return 0;
}

const [command, ...rest] = process.argv.slice(2);
const args = rest.filter((a) => !a.startsWith('-'));
const flags = new Set(rest.filter((a) => a.startsWith('-')));
switch (command) {
  case 'validate':
    process.exit(validateCommand(args[0] ?? 'content'));
    break;
  case 'fmt':
    process.exit(fmtCommand(args[0] ?? 'content', flags.has('--check')));
    break;
  default:
    console.error('usage: tailwind <validate|fmt [--check]> [path]');
    process.exit(2);
}
