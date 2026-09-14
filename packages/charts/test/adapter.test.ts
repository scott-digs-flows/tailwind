import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toEChartsOption, toKpi, toTable, label } from '../src/index.ts';
import type { DashboardChart } from '@tailwind/spec';

const bar: DashboardChart = {
  id: 'c', title: 'Revenue by category', type: 'bar',
  layout: { x: 0, y: 0, w: 6, h: 4 },
  query: { view: 'sales', metrics: ['sales.revenue'], dimensions: ['sales.category'] },
};
const rows = [
  { 'sales.category': 'Bikes', 'sales.revenue': '1580123.4' },
  { 'sales.category': 'Clothing', 'sales.revenue': '90210' },
];

test('a bar chart maps categories and values in row order', () => {
  const o = toEChartsOption(bar, rows) as { xAxis: { data: string[] }; series: { data: number[] }[] };
  assert.deepEqual(o.xAxis.data, ['Bikes', 'Clothing']);
  assert.deepEqual(o.series[0]?.data, [1580123.4, 90210]);
});

test('the adapter never aggregates — row count in equals point count out', () => {
  const o = toEChartsOption(bar, rows) as { series: { data: number[] }[] };
  assert.equal(o.series[0]?.data.length, rows.length,
    'any reshaping here would be a second computation site (binding constraint 2)');
});

test('a time dimension is read at its declared granularity', () => {
  const line: DashboardChart = {
    ...bar, type: 'line',
    query: { view: 'sales', metrics: ['sales.revenue'], time_dimensions: [{ member: 'sales.order_date', granularity: 'month' }] },
  };
  const o = toEChartsOption(line, [{ 'sales.order_date.month': '2025-03-01T00:00:00.000', 'sales.revenue': 5 }]) as { xAxis: { data: string[] } };
  assert.deepEqual(o.xAxis.data, ['2025-03']);
});

test('a KPI reads the first metric of the first row', () => {
  assert.equal(toKpi(bar, rows).value, 1580123.4);
});

test('a KPI of an empty result is zero, not NaN', () => {
  assert.equal(toKpi(bar, []).value, 0);
});

test('a table exposes dimensions then metrics', () => {
  assert.deepEqual(toTable(bar, rows).columns.map((c) => c.key), ['sales.category', 'sales.revenue']);
});

test('labels are humanised from the member name', () => {
  assert.equal(label('sales.order_count'), 'Order count');
});
