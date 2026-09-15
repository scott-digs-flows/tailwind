import type { DashboardChart, Notice } from '@tailwind/spec';
import type { ChartOutcome } from '@tailwind/charts';
import type { Envelope, EnvelopeMeta, QueryData } from './api';

/**
 * FR-VIZ-13's hardest clause, as a pure module: *"rendering a previous query's result
 * while a new one is in flight ... is a defect."*
 *
 * The naive component holds `rows` in state and replaces them when the next response
 * arrives. Every test of the first load passes, and the bug appears only in the gap:
 * change a filter, and for as long as the new query takes, the old number sits there
 * with a current-looking "as of" under it. Nothing on screen is marked as out of date,
 * because nothing on screen knows it is. That is a confident chart with a wrong number
 * -- the failure `00-vision.md` says the product exists to remove -- and it is worse
 * than a spinner in the specific way that matters: a reader acts on it.
 *
 * The fix is to make the stale case unrepresentable rather than to remember to clear
 * state. Held rows are stamped with the REQUEST they came from, and the renderer asks
 * for the outcome of the request it is currently showing. A mismatch is not "rows we
 * have for a moment longer"; it is a different question's answer, and `outcomeFor`
 * returns `rows: null` for it. There is no ordering of effects, no double render and no
 * forgotten `setRows(null)` that can produce a stale number, because the stale number is
 * never reachable from the identity on screen.
 *
 * The same stamp drops out-of-order responses: two in-flight queries for two different
 * filters can land in either order, and only the one matching the current request id is
 * ever shown.
 */

/**
 * Everything that decides WHICH question is being asked. Not the chart's title or its
 * layout -- those change what is drawn, not what is counted, and re-querying on them
 * would put a spinner on screen for a cosmetic edit.
 *
 * `attempt` is part of the identity so that a retry is a new request rather than the
 * same one: without it, a response from the failed attempt could still be accepted
 * after the reader has asked for a fresh one.
 */
export function requestIdFor(chart: DashboardChart, freshness: string, attempt: number): string {
  return JSON.stringify([chart.query, freshness, attempt]);
}

export interface ChartQueryState {
  /** The request whose result is held below. `null` before anything has settled. */
  readonly settledRequestId: string | null;
  /** Bumped by a retry; feeds `requestIdFor`, so a retry cannot accept an old answer. */
  readonly attempt: number;
  readonly rows: QueryData['rows'] | null;
  readonly sql: string;
  readonly meta: EnvelopeMeta | null;
  readonly failure: { reason: string; traceId: string | null } | null;
}

export type ChartQueryEvent =
  | { type: 'resolved'; requestId: string; envelope: Envelope<QueryData> }
  | { type: 'rejected'; requestId: string; reason: string; traceId: string | null }
  | { type: 'retry' };

export const initialChartQueryState: ChartQueryState = {
  settledRequestId: null,
  attempt: 0,
  rows: null,
  sql: '',
  meta: null,
  failure: null,
};

export function chartQueryReducer(state: ChartQueryState, event: ChartQueryEvent): ChartQueryState {
  switch (event.type) {
    case 'resolved':
      return {
        ...state,
        settledRequestId: event.requestId,
        rows: event.envelope.data.rows,
        sql: event.envelope.data.sql,
        meta: event.envelope.meta,
        failure: null,
      };
    case 'rejected':
      return {
        ...state,
        settledRequestId: event.requestId,
        // Cleared, not kept. A failed refresh leaves nothing to show: the previous
        // rows answered a question nobody is asking any more, and the SQL and the
        // as-of belong to them.
        rows: null,
        sql: '',
        meta: null,
        failure: { reason: event.reason, traceId: event.traceId },
      };
    case 'retry':
      return { ...state, attempt: state.attempt + 1 };
  }
}

/**
 * The guard. What is known about `requestId` -- and only about `requestId`.
 *
 * `notices` is gated with the rows for the same reason they are: a truncation warning
 * from the previous filter is as misleading as the number it was attached to.
 */
export function outcomeFor(state: ChartQueryState, requestId: string): ChartOutcome {
  if (state.settledRequestId !== requestId) return { rows: null, failure: null, notices: [] };
  return {
    rows: state.rows,
    failure: state.failure?.reason ?? null,
    notices: (state.meta?.notices ?? []) as Notice[],
  };
}

/** The meta to render beneath a chart, or null while it would describe another query. */
export function metaFor(state: ChartQueryState, requestId: string): EnvelopeMeta | null {
  return state.settledRequestId === requestId ? state.meta : null;
}

/** The SQL behind what is on screen (FR-CON-02), under the same rule. */
export function sqlFor(state: ChartQueryState, requestId: string): string {
  return state.settledRequestId === requestId ? state.sql : '';
}

/** The support reference for a failure on screen, or null. */
export function traceIdFor(state: ChartQueryState, requestId: string): string | null {
  return state.settledRequestId === requestId ? (state.failure?.traceId ?? null) : null;
}
