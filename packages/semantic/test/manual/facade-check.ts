/** Manual smoke check against a running stack. Not part of `pnpm test` (needs Cube up). */
import { DEFAULT_FRESHNESS } from '@tailwind/spec';
import { runQuery, pocSystemContext } from '../../src/index.ts';

const r = await runQuery(
  pocSystemContext(),
  {
    view: 'sales',
    metrics: ['sales.revenue'],
    dimensions: ['sales.region'],
    filters: [{ member: 'sales.category', operator: 'equals', values: ['Bikes'] }],
    order: [{ member: 'sales.revenue', dir: 'desc' }],
  },
  DEFAULT_FRESHNESS,
);
console.log('rows:');
for (const row of r.rows) console.log('  ', JSON.stringify(row));
console.log('\ngenerated SQL (FR-CON-02):\n ', r.sql.replace(/\s+/g, ' ').slice(0, 260));
