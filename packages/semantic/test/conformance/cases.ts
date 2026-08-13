import type { SemanticQuery } from '../../src/index.ts';

/**
 * T-097. The conformance suite is what DEFINES "supported" for a dialect
 * (FR-SEM-13), and its first job is acceptance-testing the engine we bet the product
 * on -- not pricing dialect #2. Three mirror bugs on 2026-08-12 all surfaced only when
 * a real engine parsed a real file; this is the standing answer.
 *
 * Expected values come from `oracle.json`, computed in plain Python straight off the
 * CSVs. An expectation produced by the thing under test proves nothing.
 */
export interface Case {
  id: string;
  topology: 'flat' | 'fan-out' | 'chasm' | 'grain';
  why: string;
  query: SemanticQuery;
  /** Oracle key, or a function over the oracle for grouped results. */
  expect: (oracle: Record<string, unknown>) => unknown;
  /** Reduce the engine's rows to a comparable shape. */
  actual: (rows: Record<string, unknown>[]) => unknown;
}

const n = (v: unknown): number => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const one = (rows: Record<string, unknown>[], k: string): number => n(rows[0]?.[k]);
const grouped = (rows: Record<string, unknown>[], dim: string, m: string): Record<string, number> =>
  Object.fromEntries(rows.map((r) => [String(r[dim]), n(r[m])]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

export const CASES: Case[] = [
  // ---- flat: single fact, no join. The floor. --------------------------------
  { id: 'flat/sum', topology: 'flat', why: 'a plain additive measure on one fact',
    query: { view: 'sales', metrics: ['sales.revenue'] },
    expect: (o) => o['total_line_amount'], actual: (r) => one(r, 'sales.revenue') },
  { id: 'flat/count', topology: 'flat', why: 'count on the same fact',
    query: { view: 'sales', metrics: ['sales.line_count'] },
    expect: (o) => o['line_count'], actual: (r) => one(r, 'sales.line_count') },
  { id: 'flat/group', topology: 'flat', why: 'group by a dimension on the same cube',
    query: { view: 'sales', metrics: ['sales.revenue'], dimensions: ['sales.category'] },
    expect: (o) => o['line_amount_by_category'], actual: (r) => grouped(r, 'sales.category', 'sales.revenue') },

  // ---- fan-out: header measure across a one-to-many join ---------------------
  // This is the criterion Cube won ADR-003 on, weighted x3. If any case in the suite
  // is going to fail, it should be one of these.
  { id: 'fanout/header-measure-alone', topology: 'fan-out', why: 'header amount with no join in play',
    query: { view: 'sales', metrics: ['sales.freight'] },
    expect: (o) => o['total_freight'], actual: (r) => one(r, 'sales.freight') },
  { id: 'fanout/header-by-joined-dim', topology: 'fan-out',
    why: 'THE trap: freight is per ORDER, grouped by a customer dimension one join away',
    query: { view: 'sales', metrics: ['sales.freight'], dimensions: ['sales.region'] },
    expect: (o) => o['freight_by_region'], actual: (r) => grouped(r, 'sales.region', 'sales.freight') },
  { id: 'fanout/header-by-line-dim', topology: 'fan-out',
    why: 'freight grouped by a LINE dimension -- each order counted ONCE per category group',
    // The guarantee is PER-GROUP correctness, not that groups sum to the ungrouped total.
    // An order spanning three categories legitimately appears in all three, so the sum
    // across groups exceeds true freight. What must NOT happen is freight multiplied by
    // the line COUNT within a group -- that is the fan-out. Deduplicated expectations
    // come from the oracle, computed in Python off the CSVs.
    query: { view: 'sales', metrics: ['sales.freight'], dimensions: ['sales.category'] },
    expect: (o) => o['freight_by_category_dedup'],
    actual: (r) => grouped(r, 'sales.category', 'sales.freight') },
  { id: 'fanout/mixed-grain-measures', topology: 'fan-out', why: 'header and line measures together',
    query: { view: 'sales', metrics: ['sales.freight', 'sales.revenue'] },
    expect: (o) => [o['total_freight'], o['total_line_amount']],
    actual: (r) => [one(r, 'sales.freight'), one(r, 'sales.revenue')] },
  { id: 'fanout/order-count', topology: 'fan-out', why: 'counting the header across the one-to-many',
    query: { view: 'sales', metrics: ['sales.order_count'] },
    expect: (o) => o['order_count'], actual: (r) => one(r, 'sales.order_count') },

  // ---- chasm: two independent one-to-many branches off customers -------------
  { id: 'chasm/two-facts', topology: 'chasm',
    why: 'THE chasm: orders and tickets both fan out from customers',
    query: { view: 'sales', metrics: ['sales.freight', 'sales.ticket_hours'] },
    expect: (o) => [o['total_freight'], o['total_ticket_hours']],
    actual: (r) => [one(r, 'sales.freight'), one(r, 'sales.ticket_hours')] },
  { id: 'chasm/two-facts-by-shared-dim', topology: 'chasm', why: 'both facts grouped by the shared dimension',
    query: { view: 'sales', metrics: ['sales.freight', 'sales.ticket_hours'], dimensions: ['sales.region'] },
    expect: (o) => o['freight_by_region'], actual: (r) => grouped(r, 'sales.region', 'sales.freight') },
  { id: 'chasm/customer-count', topology: 'chasm', why: 'dimension-table count across two fan-outs',
    query: { view: 'sales', metrics: ['sales.customer_count'] },
    expect: (o) => o['customer_count'], actual: (r) => one(r, 'sales.customer_count') },

  // ---- grain matrix: the same measure must roll up consistently --------------
  ...(['day', 'week', 'month', 'quarter', 'year'] as const).map<Case>((g) => ({
    id: `grain/${g}`,
    topology: 'grain',
    why: `revenue at ${g} grain must sum to the same total as no grain at all`,
    query: { view: 'sales', metrics: ['sales.revenue'], time_dimensions: [{ member: 'sales.order_date', granularity: g }], limit: 5000 },
    expect: (o) => o['total_line_amount'],
    actual: (r) => n(r.reduce((s, x) => s + Number(x['sales.revenue'] ?? 0), 0)),
  })),

  // ---- metric shapes ---------------------------------------------------------
  { id: 'shape/filtered', topology: 'flat', why: 'a filter must narrow rows, not change the aggregate rule',
    query: { view: 'sales', metrics: ['sales.revenue'], filters: [{ member: 'sales.category', operator: 'equals', values: ['Bikes'] }] },
    expect: (o) => (o['line_amount_by_category'] as Record<string, number>)['Bikes'],
    actual: (r) => one(r, 'sales.revenue') },
  { id: 'shape/multi-dim', topology: 'fan-out', why: 'two dimensions from two different cubes',
    query: { view: 'sales', metrics: ['sales.revenue'], dimensions: ['sales.region', 'sales.category'] },
    expect: (o) => o['total_line_amount'],
    actual: (r) => n(r.reduce((s, x) => s + Number(x['sales.revenue']), 0)) },
];
