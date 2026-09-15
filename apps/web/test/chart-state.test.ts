import { expect, test } from 'vitest';
import type { DashboardChart } from '@tailwind/spec';
import {
  chartQueryReducer, initialChartQueryState, metaFor, outcomeFor, requestIdFor, sqlFor,
} from '../src/chart-state';
import { okEnvelope } from './harness';
import type { Envelope, QueryData } from '../src/api';

const chart: DashboardChart = {
  id: 'revenue', title: 'Revenue', type: 'kpi',
  layout: { x: 0, y: 0, w: 3, h: 2 },
  query: { view: 'sales', metrics: ['sales.revenue'] },
};
const filtered: DashboardChart = {
  ...chart,
  query: { ...chart.query, filters: [{ member: 'sales.region', operator: 'equals', values: ['EMEA'] }] },
};

const envelope = (rows: Record<string, unknown>[]): Envelope<QueryData> =>
  okEnvelope(rows) as unknown as Envelope<QueryData>;

test('the request id changes when the question changes, and not when the title does', () => {
  const id = requestIdFor(chart, 'standard', 0);
  expect(requestIdFor({ ...chart, title: 'Revenue (EMEA)' }, 'standard', 0)).toBe(id);
  expect(requestIdFor(filtered, 'standard', 0)).not.toBe(id);
  expect(requestIdFor(chart, 'operational', 0)).not.toBe(id);
  expect(requestIdFor(chart, 'standard', 1)).not.toBe(id);
});

test('a settled result is only ever offered to the request that asked for it', () => {
  const askedA = requestIdFor(chart, 'standard', 0);
  const askedB = requestIdFor(filtered, 'standard', 0);

  const state = chartQueryReducer(initialChartQueryState, {
    type: 'resolved', requestId: askedA, envelope: envelope([{ 'sales.revenue': 1234 }]),
  });

  expect(outcomeFor(state, askedA).rows).toEqual([{ 'sales.revenue': 1234 }]);
  // The transition. Same component, same held state, different question.
  expect(outcomeFor(state, askedB).rows).toBeNull();
  expect(outcomeFor(state, askedB).notices).toEqual([]);
  expect(metaFor(state, askedB)).toBeNull();
  expect(sqlFor(state, askedB)).toBe('');
});

test('a failure clears the rows it replaces rather than sitting beside them', () => {
  const asked = requestIdFor(chart, 'standard', 0);
  const withRows = chartQueryReducer(initialChartQueryState, {
    type: 'resolved', requestId: asked, envelope: envelope([{ 'sales.revenue': 1234 }]),
  });
  const failed = chartQueryReducer(withRows, {
    type: 'rejected', requestId: asked, reason: 'It took too long.', traceId: 'trace-1',
  });

  expect(failed.rows).toBeNull();
  expect(failed.meta).toBeNull();
  expect(failed.sql).toBe('');
  expect(outcomeFor(failed, asked).failure).toBe('It took too long.');
});

test('a retry makes a new request rather than reopening the old one', () => {
  const first = requestIdFor(chart, 'standard', 0);
  const failed = chartQueryReducer(initialChartQueryState, {
    type: 'rejected', requestId: first, reason: 'It took too long.', traceId: null,
  });
  const retried = chartQueryReducer(failed, { type: 'retry' });
  const second = requestIdFor(chart, 'standard', retried.attempt);

  expect(second).not.toBe(first);
  // The failure belongs to the attempt that failed, so the retry starts from loading.
  const outcome = outcomeFor(retried, second);
  expect(outcome.failure).toBeNull();
  expect(outcome.rows).toBeNull();
});
