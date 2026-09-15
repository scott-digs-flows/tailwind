#!/usr/bin/env node
/** Fails the build if anything crossed the facade boundary (TW-170, ADR-006 D4). */
import { checkBoundaries, formatFindings, repoRoot } from './boundary-lint.ts';

const root = repoRoot(import.meta.dirname);
const findings = checkBoundaries(root);

if (findings.length > 0) {
  console.error(`boundary lint: ${findings.length} finding(s)\n${formatFindings(findings)}`);
  process.exit(1);
}
console.log('boundary lint: one door, and nothing vendor-shaped leaves it');
