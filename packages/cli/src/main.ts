#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { formatErrors, kindFromFilename, parseSpec } from '@tailwind/spec';

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
  console.log(`\n${files.length - failed}/${files.length} specs valid`);
  return failed === 0 ? 0 : 1;
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case 'validate':
    process.exit(validateCommand(rest[0] ?? 'content'));
    break;
  default:
    console.error('usage: tailwind validate [path]');
    process.exit(2);
}
