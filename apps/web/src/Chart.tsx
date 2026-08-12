import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { DashboardChart } from '@tailwind/spec';
import { toEChartsOption, toKpi, toTable, asString } from '@tailwind/charts';
import { runChartQuery, type EnvelopeMeta, type QueryData } from './api';

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

export function ChartCard({ chart, freshness }: { chart: DashboardChart; freshness: string }) {
  const [rows, setRows] = useState<QueryData['rows'] | null>(null);
  const [sql, setSql] = useState('');
  const [meta, setMeta] = useState<EnvelopeMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSql, setShowSql] = useState(false);

  useEffect(() => {
    let live = true;
    runChartQuery(chart, freshness)
      .then((env) => {
        if (!live) return;
        setRows(env.data.rows);
        setSql(env.data.sql);
        setMeta(env.meta);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [chart, freshness]);

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

      {error !== null && <p style={{ color: 'var(--bad)', fontSize: '.8rem' }}>{error}</p>}
      {error === null && rows === null && <p style={{ fontSize: '.8rem', opacity: 0.5 }}>loading…</p>}

      {rows !== null && chart.type === 'kpi' && <Kpi chart={chart} rows={rows} />}
      {rows !== null && chart.type === 'table' && <Table chart={chart} rows={rows} />}
      {rows !== null && (chart.type === 'line' || chart.type === 'bar') && <EChart chart={chart} rows={rows} />}

      {showSql && (
        <pre style={{ fontSize: '.62rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--ground)', border: '1px solid var(--rule)', borderRadius: 4, padding: '.5rem', marginTop: '.5rem', maxHeight: 160, overflow: 'auto' }}>
          {sql || '(no SQL returned)'}
        </pre>
      )}

      {meta !== null && (
        <footer style={{ fontSize: '.62rem', opacity: 0.5, marginTop: '.4rem' }}>
          {meta.freshness.class} · cache {meta.cache} · as of {new Date(meta.as_of).toLocaleString()}
        </footer>
      )}
    </section>
  );
}
