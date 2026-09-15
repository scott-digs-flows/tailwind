import { useEffect, useReducer, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { DashboardChart } from '@tailwind/spec';
import {
  toEChartsOption, toKpi, toTable, asString,
  chartState, chartNotices, type ChartState,
} from '@tailwind/charts';
import { runChartQuery, QueryFailed, type QueryData } from './api';
import {
  chartQueryReducer, initialChartQueryState, metaFor, outcomeFor, requestIdFor, sqlFor, traceIdFor,
} from './chart-state';
import { NoticeList } from './Notices';

function EChart({ chart, rows }: { chart: DashboardChart; rows: QueryData['rows'] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const inst = echarts.init(el.current);
    inst.setOption(toEChartsOption(chart, rows));
    const ro = new ResizeObserver(() => inst.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      inst.dispose();
    };
  }, [chart, rows]);
  return <div ref={el} style={{ width: '100%', flex: 1, minHeight: 0 }} />;
}

function Kpi({ chart, rows }: { chart: DashboardChart; rows: QueryData['rows'] }) {
  const { formatted } = toKpi(chart, rows);
  return (
    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
      <span style={{ fontSize: '2.4rem', fontWeight: 600, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
        {formatted}
      </span>
    </div>
  );
}

function Table({ chart, rows }: { chart: DashboardChart; rows: QueryData['rows'] }) {
  const model = toTable(chart, rows);
  return (
    <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
        <thead>
          <tr>
            {model.columns.map((c) => (
              <th key={c.key} style={{ textAlign: 'left', padding: '.35rem .5rem', borderBottom: '1px solid var(--rule)', fontWeight: 500, opacity: 0.65 }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((r, i) => (
            <tr key={i}>
              {model.columns.map((c) => (
                <td key={c.key} style={{ padding: '.35rem .5rem', borderBottom: '1px solid var(--rule)', fontVariantNumeric: 'tabular-nums' }}>
                  {asString(r[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * FR-VIZ-13. In flight, and saying so.
 *
 * A skeleton rather than the word "loading" in 10px grey, because "visibly loading" is
 * the acceptance criterion and a caption that small is read as part of the furniture.
 * `aria-busy` says the same thing to a screen reader, which cannot see the shimmer.
 */
function Loading() {
  return (
    <div
      role="status"
      aria-busy="true"
      style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', flex: 1, minHeight: 0, justifyContent: 'center' }}
    >
      <span className="tw-skeleton" style={{ height: '1.6rem', width: '55%', borderRadius: 4 }} />
      <span className="tw-skeleton" style={{ height: '.7rem', width: '80%', borderRadius: 4 }} />
      <span style={{ fontSize: '.7rem', color: 'var(--muted)' }}>Loading…</span>
    </div>
  );
}

/**
 * FR-VIZ-13. A failed chart says so IN PLACE and shows nothing else.
 *
 * Not a toast and not an empty card: the space where the number would have been is the
 * only place a reader is guaranteed to look, and an error anywhere else leaves a blank
 * rectangle that reads as "no data" -- a different and much more damaging claim.
 *
 * `reason` is written by the API in plain language. The trace id is shown because a
 * reader who reports this needs something to quote, and an opaque request id is the
 * only internal detail that is safe to show (NFR-OPS-01).
 */
function Failed({ message, traceId, onRetry }: { message: string; traceId: string | null; onRetry: () => void }) {
  return (
    <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', flex: 1, minHeight: 0, justifyContent: 'center' }}>
      <p style={{ margin: 0, fontSize: '.8rem', color: 'var(--bad)' }}>{message}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <button
          onClick={onRetry}
          style={{ font: 'inherit', fontSize: '.72rem', background: 'none', border: '1px solid var(--rule)', borderRadius: 4, padding: '.2rem .55rem', cursor: 'pointer', color: 'var(--ink)' }}
        >
          Try again
        </button>
        {traceId !== null && (
          <span style={{ fontSize: '.62rem', color: 'var(--muted)' }}>Reference {traceId}</span>
        )}
      </div>
    </div>
  );
}

/**
 * FR-VIZ-13. No rows is a statement, not a blank chart.
 *
 * An empty axis or a KPI reading `0` is the same lie in two shapes: `toKpi` on an empty
 * result formats a perfectly confident zero, and nothing on the card distinguishes
 * "the answer is zero" from "there was no answer". So the state is intercepted before
 * the adapter's formatters ever see the rows.
 */
function Empty({ message }: { message: string }) {
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', flex: 1, minHeight: 0 }}>
      <p style={{ margin: 0, fontSize: '.8rem', color: 'var(--muted)' }}>{message}</p>
    </div>
  );
}

function ChartBody({ chart, state }: { chart: DashboardChart; state: ChartState }) {
  if (state.kind !== 'data') return null;
  if (chart.type === 'kpi') return <Kpi chart={chart} rows={state.rows} />;
  if (chart.type === 'table') return <Table chart={chart} rows={state.rows} />;
  return <EChart chart={chart} rows={state.rows} />;
}

export function ChartCard({
  chart,
  dashboard,
  freshness,
  onStateChange,
}: {
  chart: DashboardChart;
  /**
   * The published dashboard this chart belongs to. Sent INSTEAD of the query, because
   * the server reads both the query and its class out of git (TW-167) -- this tab's
   * copy is as old as the page load, and a governed value a client supplies is not
   * governed.
   */
  dashboard: string;
  /**
   * The class the dashboard DECLARES. Not sent to the server, which resolves its own
   * (TW-167); it is here because it is part of the identity of the question on screen,
   * so a republished dashboard cannot have an old answer rendered under a new class.
   */
  freshness: string;
  /**
   * How the dashboard learns that this chart failed. A dashboard is N independent
   * queries, so the page above cannot know it is incomplete unless the charts say so
   * (FR-VIZ-13's third criterion). Must be referentially stable -- `App` memoises it.
   */
  onStateChange?: (chartId: string, kind: ChartState['kind']) => void;
}) {
  const [state, dispatch] = useReducer(chartQueryReducer, initialChartQueryState);
  const [showSql, setShowSql] = useState(false);

  // The identity of the question currently on screen. Everything below is read through
  // it, so a held result for a DIFFERENT question cannot be rendered: see
  // `chart-state.ts` for why that is a guard rather than a `setRows(null)` somewhere.
  const requestId = requestIdFor(chart, freshness, state.attempt);
  const outcome = outcomeFor(state, requestId);
  const view = chartState(outcome);
  const meta = metaFor(state, requestId);

  useEffect(() => {
    let live = true;
    runChartQuery(dashboard, chart)
      .then((env) => live && dispatch({ type: 'resolved', requestId, envelope: env }))
      .catch((e: unknown) => {
        if (!live) return;
        // Anything that is not a QueryFailed never reached the API's translation, so it
        // gets the generic sentence rather than `e.message`: an exception's own text is
        // written for a console, and this one is going on a dashboard.
        const failed = e instanceof QueryFailed ? e : null;
        dispatch({
          type: 'rejected',
          requestId,
          reason:
            failed?.reason ??
            'Something went wrong loading this chart, so no number is shown.',
          traceId: failed?.traceId ?? null,
        });
      });
    return () => {
      live = false;
    };
  }, [requestId, chart, dashboard, freshness]);

  // Reported from an effect rather than during render: telling a parent about our state
  // while it is rendering its own is how React ends up re-rendering forever.
  const kind = view.kind;
  useEffect(() => {
    onStateChange?.(chart.id, kind);
  }, [onStateChange, chart.id, kind]);

  return (
    <section
      style={{
        gridColumn: `span ${chart.layout.w}`,
        gridRow: `span ${chart.layout.h}`,
        display: 'flex', flexDirection: 'column',
        border: '1px solid var(--rule)', borderRadius: 6, padding: '.85rem 1rem',
        background: 'var(--panel)', minHeight: 0,
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '.5rem' }}>
        <h2 style={{ fontSize: '.82rem', fontWeight: 600, margin: 0, letterSpacing: '.01em' }}>{chart.title}</h2>
        {/* FR-CON-02: "how is this calculated?" is one click from every chart, not a debug affordance. */}
        <button
          onClick={() => setShowSql((v) => !v)}
          style={{ font: 'inherit', fontSize: '.68rem', background: 'none', border: '1px solid var(--rule)', borderRadius: 4, padding: '.1rem .4rem', cursor: 'pointer', color: 'var(--muted)' }}
        >
          SQL
        </button>
      </header>

      {/* ADR-006 amendment: severity >= warn must be rendered. It sits ABOVE the chart
          deliberately -- a caveat under a number is read after the number has already
          been believed. A truncated result that draws as a complete chart is the exact
          failure this product exists to prevent. `chartNotices` also drops them all
          when the chart has failed, where the reason below is already the whole body. */}
      <NoticeList notices={chartNotices(view, outcome.notices)} />

      {view.kind === 'loading' && <Loading />}
      {view.kind === 'failed' && (
        <Failed
          message={view.message}
          traceId={traceIdFor(state, requestId)}
          onRetry={() => dispatch({ type: 'retry' })}
        />
      )}
      {view.kind === 'empty' && <Empty message={view.message} />}
      <ChartBody chart={chart} state={view} />

      {showSql && (
        <pre style={{ fontSize: '.62rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--ground)', border: '1px solid var(--rule)', borderRadius: 4, padding: '.5rem', marginTop: '.5rem', maxHeight: 160, overflow: 'auto' }}>
          {sqlFor(state, requestId) || '(no SQL returned)'}
        </pre>
      )}

      {/* Gated on `meta` being the CURRENT request's, which is the same rule as the
          rows: an as-of from the previous filter under a chart that is still loading
          the next one is a stale claim wearing a fresh timestamp (FR-FRESH-03). */}
      {meta !== null && (
        <footer style={{ fontSize: '.62rem', opacity: 0.5, marginTop: '.4rem' }}>
          {/* The class the server EXECUTED under, not the one this page loaded with.
              Since TW-167/TW-168 those are the same value by construction -- and on the
              day they are not (a bundle republished under the tab), the footer should
              say what produced the number in front of the reader. */}
          {meta.freshness.class} · cache {meta.cache} ·{' '}
          {/* FR-FRESH-03: say "unknown" rather than rendering the request time as
              though it were the data's as-of. */}
          {meta.as_of === null
            ? 'as-of unknown'
            : `as of ${new Date(meta.as_of).toLocaleString()}${meta.freshness.stale === true ? ' (stale)' : ''}`}
        </footer>
      )}
    </section>
  );
}
