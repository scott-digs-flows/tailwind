/** Manual smoke check against a running stack. Not part of `pnpm test` (needs Cube up). */
import { runQuery, pocSystemContext } from '../../src/index.ts';

const opts = { url: process.env['CUBE_URL'] ?? 'http://localhost:7400/cubejs-api/v1', apiSecret: 'dev-only-not-a-secret' };
const r = await runQuery(
  opts,
  {
    view: 'sales',
    metrics: ['sales.revenue'],
    dimensions: ['sales.region'],
    filters: [{ member: 'sales.category', operator: 'equals', values: ['Bikes'] }],
    order: [{ member: 'sales.revenue', dir: 'desc' }],
  },
  pocSystemContext(),
);
console.log('rows:');
for (const row of r.rows) console.log('  ', JSON.stringify(row));
console.log('\ngenerated SQL (FR-CON-02):\n ', r.sql.replace(/\s+/g, ' ').slice(0, 260));
