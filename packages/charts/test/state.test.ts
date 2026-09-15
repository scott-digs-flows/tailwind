import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Notice } from '@tailwind/spec';
import {
  chartState,
  chartNotices,
  dashboardIncompleteNotice,
  toKpi,
  NO_ROWS_MESSAGE,
  NO_VISIBLE_ROWS_MESSAGE,
  UNEXPLAINED_FAILURE_MESSAGE,
} from '../src/index.ts';
import type { DashboardChart } from '@tailwind/spec';

const kpi: DashboardChart = {
  id: 'revenue', title: 'Revenue', type: 'kpi',
  layout: { x: 0, y: 0, w: 3, h: 2 },
  query: { view: 'sales', metrics: ['sales.revenue'] },
};

const truncated: Notice = {
  code: 'row_limit_reached', severity: 'warn', message: 'Showing the first 10,000 rows.',
};

test('no settled result for the query on screen is LOADING, never data', () => {
  assert.deepEqual(chartState({ rows: null, failure: null, notices: [] }), { kind: 'loading' });
});

test('a failed query is FAILED and carries the reason it was given', () => {
  const state = chartState({
    rows: null,
    failure: 'The data warehouse could not be reached, so this chart has no number to show.',
    notices: [],
  });
  assert.equal(state.kind, 'failed');
  assert.match(state.kind === 'failed' ? state.message : '', /could not be reached/);
});

test('a failure with no reason still says something a reader can understand', () => {
  const state = chartState({ rows: null, failure: '', notices: [] });
  assert.deepEqual(state, { kind: 'failed', message: UNEXPLAINED_FAILURE_MESSAGE });
});

/**
 * The case that motivates the whole module. A surface holding both a previous result
 * and a fresh failure must not draw the result: it is an answer to a question that has
 * since failed, and drawing it is the confident-wrong-number failure in its purest form.
 */
test('a failure beats rows that are still in hand', () => {
  const state = chartState({
    rows: [{ 'sales.revenue': 1234 }],
    failure: 'This chart took too long to return and was stopped.',
    notices: [],
  });
  assert.equal(state.kind, 'failed');
});

test('zero rows is EMPTY and says so in the reader\'s terms', () => {
  assert.deepEqual(chartState({ rows: [], failure: null, notices: [] }), {
    kind: 'empty',
    message: NO_ROWS_MESSAGE,
  });
});

/**
 * The negative control for the empty state: without it, `toKpi` is perfectly happy to
 * format a zero out of no rows at all. The assertion is that the adapter still does
 * exactly that -- so if the guard is ever removed, this test is the reason it is not
 * silently harmless.
 */
test('an empty result would otherwise render a confident zero', () => {
  assert.equal(toKpi(kpi, []).formatted, '0');
  assert.notEqual(chartState({ rows: [], failure: null, notices: [] }).kind, 'data');
});

test('empty BY POLICY says something different from empty by filter', () => {
  const policy: Notice = {
    code: 'empty_by_policy', severity: 'warn', message: 'Rows were removed by access policy.',
  };
  const state = chartState({ rows: [], failure: null, notices: [policy] });
  assert.deepEqual(state, { kind: 'empty', message: NO_VISIBLE_ROWS_MESSAGE });
  assert.notEqual(NO_VISIBLE_ROWS_MESSAGE, NO_ROWS_MESSAGE);
});

test('rows are DATA and reach the renderer unchanged', () => {
  const rows = [{ 'sales.revenue': 1234 }];
  assert.deepEqual(chartState({ rows, failure: null, notices: [] }), { kind: 'data', rows });
});

test('a warn notice is rendered alongside data; an info one is not', () => {
  const info: Notice = { code: 'served_stale', severity: 'info', message: 'from cache' };
  const state = chartState({ rows: [{ x: 1 }], failure: null, notices: [truncated, info] });
  assert.deepEqual(chartNotices(state, [truncated, info]).map((n) => n.code), ['row_limit_reached']);
});

test('errors sort above warnings, so the worst thing is read first', () => {
  const partial: Notice = { code: 'partial_failure', severity: 'error', message: 'incomplete' };
  const state = chartState({ rows: [{ x: 1 }], failure: null, notices: [] });
  assert.deepEqual(
    chartNotices(state, [truncated, partial]).map((n) => n.code),
    ['partial_failure', 'row_limit_reached'],
  );
});

test('a failed chart does not repeat its own reason as a banner', () => {
  const state = chartState({ rows: null, failure: 'no', notices: [] });
  assert.deepEqual(chartNotices(state, [truncated]), []);
});

test('a dashboard with nothing failed says nothing', () => {
  assert.equal(
    dashboardIncompleteNotice([{ kind: 'data' }, { kind: 'empty' }, { kind: 'loading' }]),
    null,
  );
});

test('a dashboard with one failed chart says so, and counts', () => {
  const notice = dashboardIncompleteNotice([{ kind: 'data' }, { kind: 'failed' }, { kind: 'data' }]);
  assert.equal(notice?.code, 'partial_failure');
  assert.equal(notice?.severity, 'error');
  assert.match(notice?.message ?? '', /1 of 3 charts/);
  assert.match(notice?.message ?? '', /incomplete/);
});

test('the count agrees with the total, not with the failures', () => {
  const notice = dashboardIncompleteNotice([{ kind: 'failed' }, { kind: 'failed' }]);
  assert.match(notice?.message ?? '', /2 of 2 charts/);
});
