#!/usr/bin/env node
/** Fails the build if the schema or the connecting role would make RLS inert (T-130). */
import { checkTenancy, formatFindings } from './tenancy-guard.ts';
import { close, getPool, migrate } from './db.ts';

if (process.argv.includes('--migrate')) await migrate();
const findings = await checkTenancy(getPool());
await close();

if (findings.length > 0) {
  console.error(`tenancy guard: ${findings.length} finding(s)\n${formatFindings(findings)}`);
  process.exit(1);
}
console.log('tenancy guard: schema and connecting role are sound');
