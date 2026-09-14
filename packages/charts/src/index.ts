import type { DashboardChart } from '@tailwind/spec';

export type ResultRow = Record<string, unknown>;

/**
 * ADR-005 D2: a NARROW adapter. Spec plus result set in, chart config out, as a pure
 * function with no DOM and no ECharts import.
 *
 * Two reasons that shape matters. The headless renderer (T-129) and the browser must
 * produce the SAME picture or the CI screenshot stops being evidence -- one function,
 * two callers. And keeping ECharts behind this boundary is what makes the library
 * swappable without touching the specs.
 *
 * It does NOT aggregate, filter or derive. Binding constraint 2: every number comes
 * out of the semantic layer already computed. A transform grammar here would be the
 * second computation site that disqualified Vega-Lite in ADR-005.
 */

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const asString = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Cube returns `view.member`; a time dimension at a grain returns `view.member.month`. */
function seriesKeys(chart: DashboardChart): { category: string | null; metrics: string[] } {
  const q = chart.query;
  const timeKey = q.time_dimensions?.[0]
    ? `${q.time_dimensions[0].member}.${q.time_dimensions[0].granularity}`
    : null;
  return { category: timeKey ?? q.dimensions?.[0] ?? null, metrics: q.metrics };
}

/** Short, human labels: `sales.revenue` -> `Revenue`. */
export const label = (member: string): string => {
  const last = member.split('.').filter((p) => p !== '')[1] ?? member;
  return last.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
};

export interface KpiValue {
  value: number;
  formatted: string;
}

export function toKpi(chart: DashboardChart, rows: ResultRow[]): KpiValue {
  const metric = chart.query.metrics[0] ?? '';
  const value = num(rows[0]?.[metric]);
  return {
    value,
    formatted: new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value),
  };
}

export interface TableModel {
  columns: { key: string; label: string }[];
  rows: ResultRow[];
}

export function toTable(chart: DashboardChart, rows: ResultRow[]): TableModel {
  const q = chart.query;
  const keys = [...(q.dimensions ?? []), ...(q.time_dimensions ?? []).map((t) => `${t.member}.${t.granularity}`), ...q.metrics];
  return { columns: keys.map((k) => ({ key: k, label: label(k) })), rows };
}

/** An ECharts option object, typed loosely so this package need not import ECharts. */
export type ChartOption = Record<string, unknown>;

export function toEChartsOption(chart: DashboardChart, rows: ResultRow[]): ChartOption {
  const { category, metrics } = seriesKeys(chart);
  const categories = category === null ? [''] : rows.map((r) => asString(r[category]));
  const isLine = chart.type === 'line';

  return {
    grid: { left: 56, right: 16, top: 24, bottom: 40, containLabel: true },
    tooltip: { trigger: 'axis' },
    legend: metrics.length > 1 ? { data: metrics.map(label), bottom: 0 } : undefined,
    xAxis: {
      type: 'category',
      data: categories.map((c) => (isLine && c.length >= 10 ? c.slice(0, 7) : c)),
      axisTick: { alignWithLabel: true },
    },
    yAxis: { type: 'value' },
    series: metrics.map((m) => ({
      name: label(m),
      type: isLine ? 'line' : 'bar',
      smooth: false,
      showSymbol: rows.length <= 40,
      data: rows.map((r) => num(r[m])),
    })),
  };
}
