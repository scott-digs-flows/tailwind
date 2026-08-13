import type { SemanticQuery } from '../../src/index.ts';

/**
 * T-097, against AdventureWorks on ClickHouse -- the warehouse of record (Q-01).
 *
 * The suite DEFINES what "supported" means for a dialect (FR-SEM-13), and its first
 * job is acceptance-testing the engine we bet the product on. Expected values come
 * from `oracle.json`, computed by querying ClickHouse DIRECTLY. An expectation
 * produced by the thing under test proves nothing.
 *
 * The two traps are real here, not contrived:
 *   FAN-OUT -- `standard_cost` is held once per PRODUCT. Summed across sales lines it
 *              comes out 156x too large (26,693,830 against a true 171,535).
 *   CHASM   -- reseller and internet sales both fan out from dim_product.
 */
export interface Case {
  id: string;
  topology: 'flat' | 'fan-out' | 'chasm' | 'grain';
  why: string;
  query: SemanticQuery;
  expect: (oracle: Record<string, unknown>) => unknown;
  actual: (rows: Record<string, unknown>[]) => unknown;
}

const n = (v: unknown): number => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const one = (rows: Record<string, unknown>[], k: string): number => n(rows[0]?.[k]);
const sum = (rows: Record<string, unknown>[], k: string): number =>
  n(rows.reduce((s, r) => s + Number(r[k] ?? 0), 0));
const grouped = (rows: Record<string, unknown>[], dim: string, m: string): Record<string, number> =>
  Object.fromEntries(
    rows
      .map((r) => [r[dim] === null || r[dim] === undefined ? '' : String(r[dim]), n(r[m])] as const)
      .sort((a, b) => a[0].localeCompare(b[0])),
  );

export const CASES: Case[] = [
  // ---- flat -----------------------------------------------------------------
  { id: 'flat/sum', topology: 'flat', why: 'an additive measure on one fact',
    query: { view: 'sales', metrics: ['sales.reseller_sales'] },
    expect: (o) => o['total_reseller_sales'], actual: (r) => one(r, 'sales.reseller_sales') },
  { id: 'flat/count', topology: 'flat', why: 'count on the same fact',
    query: { view: 'sales', metrics: ['sales.reseller_line_count'] },
    expect: (o) => o['reseller_line_count'], actual: (r) => one(r, 'sales.reseller_line_count') },
  { id: 'flat/group-joined-dim', topology: 'flat', why: 'fact measure grouped by a dimension one join away',
    query: { view: 'sales', metrics: ['sales.reseller_sales'], dimensions: ['sales.product_line'], limit: 100 },
    expect: (o) => o['reseller_sales_by_product_line'],
    actual: (r) => grouped(r, 'sales.product_line', 'sales.reseller_sales') },

  // ---- fan-out: a PRODUCT-level measure across a one-to-many ------------------
  // The criterion Cube won ADR-003 on, weighted x3. If anything fails, expect it here.
  { id: 'fanout/header-alone', topology: 'fan-out', why: 'standard_cost with no fact in the query',
    query: { view: 'sales', metrics: ['sales.product_standard_cost'] },
    expect: (o) => o['total_product_standard_cost'], actual: (r) => one(r, 'sales.product_standard_cost') },
  { id: 'fanout/dim-measure-across-facts', topology: 'fan-out',
    why: 'a measure on a DIMENSION table makes that cube a fact; two facts need a direct join to the shared dimension, and dim_product has none to dim_sales_territory -- so Cube REFUSES rather than inventing an attribution rule',
    // Asserting the refusal, not a number. "Product cost by territory" has no single
    // right answer (cost attributed via reseller sales? internet? both?), and a
    // refusal is the correct response to an ambiguous question -- the same shape as
    // FR-AI-02, where the assistant declines instead of guessing.
    query: { view: 'sales', metrics: ['sales.product_standard_cost'], dimensions: ['sales.country'], limit: 100 },
    expect: () => 'REFUSED',
    actual: (r) => (r.length === 0 ? 'REFUSED' : 'ANSWERED') },
  { id: 'fanout/header-by-own-dim', topology: 'fan-out',
    why: 'product cost by its own attribute -- each product counted once per group',
    query: { view: 'sales', metrics: ['sales.product_standard_cost'], dimensions: ['sales.product_line'], limit: 100 },
    expect: (o) => o['standard_cost_by_product_line_dedup'],
    actual: (r) => grouped(r, 'sales.product_line', 'sales.product_standard_cost') },
  { id: 'fanout/mixed-grain', topology: 'fan-out', why: 'product-grain and line-grain measures together',
    query: { view: 'sales', metrics: ['sales.product_standard_cost', 'sales.reseller_sales'] },
    expect: (o) => [o['total_product_standard_cost'], o['total_reseller_sales']],
    actual: (r) => [one(r, 'sales.product_standard_cost'), one(r, 'sales.reseller_sales')] },
  { id: 'fanout/dimension-count', topology: 'fan-out', why: 'counting the dimension across the one-to-many',
    query: { view: 'sales', metrics: ['sales.product_count'] },
    expect: (o) => o['product_count'], actual: (r) => one(r, 'sales.product_count') },

  // ---- fan-out, the reachable kind: header measure across a one-to-many ------
  // These are the cases that actually exercise Cube's deduplication path. The
  // dim_product ones above resolve to multi-fact aggregation and never traverse the
  // join, which is why the negative control could not fire before T-136.
  { id: 'fanout/header-freight-alone', topology: 'fan-out', why: 'freight is charged once per ORDER',
    query: { view: 'sales', metrics: ['sales.order_freight'] },
    expect: (o) => o['total_order_freight'], actual: (r) => one(r, 'sales.order_freight') },
  { id: 'fanout/header-with-line-measure', topology: 'fan-out',
    why: 'THE trap: order freight alongside a LINE measure forces the one-to-many; freight must not multiply by line count',
    query: { view: 'sales', metrics: ['sales.order_freight', 'sales.reseller_line_count'] },
    expect: (o) => [o['total_order_freight'], o['reseller_line_count']],
    actual: (r) => [one(r, 'sales.order_freight'), one(r, 'sales.reseller_line_count')] },
  { id: 'fanout/header-by-line-dim', topology: 'fan-out',
    why: 'order freight grouped by a LINE dimension -- each order counted once per product line it touches',
    query: { view: 'sales', metrics: ['sales.order_freight'], dimensions: ['sales.product_line'], limit: 100 },
    expect: (o) => o['order_freight_by_product_line_dedup'],
    actual: (r) => grouped(r, 'sales.product_line', 'sales.order_freight') },
  { id: 'fanout/header-count-with-lines', topology: 'fan-out', why: 'counting headers across the one-to-many',
    query: { view: 'sales', metrics: ['sales.order_count', 'sales.reseller_line_count'] },
    expect: (o) => [o['order_count'], o['reseller_line_count']],
    actual: (r) => [one(r, 'sales.order_count'), one(r, 'sales.reseller_line_count')] },

  // ---- chasm: two facts, both fanning out from dim_product -------------------
  { id: 'chasm/two-facts', topology: 'chasm', why: 'THE chasm: reseller and internet sales in one query',
    query: { view: 'sales', metrics: ['sales.reseller_sales', 'sales.internet_sales'] },
    expect: (o) => [o['total_reseller_sales'], o['total_internet_sales']],
    actual: (r) => [one(r, 'sales.reseller_sales'), one(r, 'sales.internet_sales')] },
  { id: 'chasm/two-facts-by-shared-dim', topology: 'chasm', why: 'both facts grouped by the shared dimension',
    query: { view: 'sales', metrics: ['sales.reseller_sales', 'sales.internet_sales'], dimensions: ['sales.product_line'], limit: 100 },
    expect: (o) => o['reseller_sales_by_product_line'],
    actual: (r) => grouped(r, 'sales.product_line', 'sales.reseller_sales') },
  { id: 'chasm/three-way', topology: 'chasm', why: 'two facts plus a product-level measure',
    query: { view: 'sales', metrics: ['sales.reseller_sales', 'sales.internet_sales', 'sales.product_standard_cost'] },
    expect: (o) => [o['total_reseller_sales'], o['total_internet_sales'], o['total_product_standard_cost']],
    actual: (r) => [one(r, 'sales.reseller_sales'), one(r, 'sales.internet_sales'), one(r, 'sales.product_standard_cost')] },

  // ---- grain matrix ----------------------------------------------------------
  ...(['day', 'week', 'month', 'quarter', 'year'] as const).map<Case>((g) => ({
    id: `grain/${g}`,
    topology: 'grain',
    why: `reseller sales at ${g} grain must sum to the ungrouped total`,
    query: { view: 'sales', metrics: ['sales.reseller_sales'],
             time_dimensions: [{ member: 'sales.reseller_order_date', granularity: g }], limit: 5000 },
    expect: (o) => o['total_reseller_sales'],
    actual: (r) => sum(r, 'sales.reseller_sales'),
  })),

  // ---- metric shapes ---------------------------------------------------------
  { id: 'shape/filtered', topology: 'flat', why: 'a filter narrows rows without changing the aggregate rule',
    query: { view: 'sales', metrics: ['sales.reseller_sales'],
             filters: [{ member: 'sales.product_line', operator: 'equals', values: ['M '] }] },
    expect: (o) => (o['reseller_sales_by_product_line'] as Record<string, number>)['M '],
    actual: (r) => one(r, 'sales.reseller_sales') },
  { id: 'shape/multi-dim', topology: 'fan-out', why: 'two dimensions from two different cubes',
    query: { view: 'sales', metrics: ['sales.reseller_sales'],
             dimensions: ['sales.country', 'sales.product_line'], limit: 500 },
    expect: (o) => o['total_reseller_sales'], actual: (r) => sum(r, 'sales.reseller_sales') },
  { id: 'shape/by-country', topology: 'flat', why: 'fact measure by a second dimension table',
    query: { view: 'sales', metrics: ['sales.reseller_sales'], dimensions: ['sales.country'], limit: 100 },
    expect: (o) => o['reseller_sales_by_country'],
    actual: (r) => grouped(r, 'sales.country', 'sales.reseller_sales') },
];
