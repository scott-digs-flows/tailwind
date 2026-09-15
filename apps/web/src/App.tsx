import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dashboard } from '@tailwind/spec';
import { dashboardIncompleteNotice, type ChartState } from '@tailwind/charts';
import { fetchDashboard, QueryFailed, type EnvelopeMeta } from './api';
import { ChartCard } from './Chart';
import { NoticeList } from './Notices';

const DASHBOARD = 'sales_overview';

export function App() {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [meta, setMeta] = useState<EnvelopeMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Every chart's current state, by chart id.
   *
   * The dashboard holds this because it is the only thing that can see all the charts
   * at once, and FR-VIZ-13 asks it to say that the page is incomplete -- a statement no
   * individual card is in a position to make. It is display state and nothing more: the
   * numbers stay where they are computed.
   */
  const [chartStates, setChartStates] = useState<Record<string, ChartState['kind']>>({});

  // Memoised so it is referentially stable. `ChartCard` reports through an effect keyed
  // on this callback; a new function every render would make that effect fire forever.
  const onChartState = useCallback((chartId: string, kind: ChartState['kind']) => {
    setChartStates((prev) => (prev[chartId] === kind ? prev : { ...prev, [chartId]: kind }));
  }, []);

  useEffect(() => {
    fetchDashboard(DASHBOARD)
      .then((env) => {
        setDash(env.data);
        setMeta(env.meta);
      })
      .catch((e: unknown) => {
        // Same rule as a chart: the API's plain-language reason, never the exception's
        // own text, which names files and validators.
        setError(
          e instanceof QueryFailed
            ? e.reason
            : 'This dashboard could not be opened. Try again in a moment.',
        );
      });
  }, []);

  /**
   * Reported only for charts that have actually reported, so a dashboard mid-load does
   * not briefly claim that charts which have not spoken yet are fine. The denominator
   * is the number of charts the dashboard declares, which is what makes "1 of 6"
   * meaningful while the other five are still arriving.
   */
  const incomplete = useMemo(() => {
    if (dash === null) return null;
    return dashboardIncompleteNotice(
      dash.charts.map((c) => ({ kind: chartStates[c.id] ?? 'loading' })),
    );
  }, [dash, chartStates]);

  if (error !== null) return <main style={{ padding: '2rem' }}><p role="alert" style={{ color: 'var(--bad)' }}>{error}</p></main>;
  if (dash === null) return <main style={{ padding: '2rem', opacity: 0.6 }} role="status" aria-busy="true">Loading dashboard…</main>;

  const cert = dash.meta.tailwind.certification;

  return (
    <main style={{ padding: '1.5rem 2rem 3rem', maxWidth: 1440, margin: '0 auto' }}>
      <header style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
          <h1 style={{ fontSize: '1.35rem', margin: 0, letterSpacing: '-.01em' }}>{dash.title}</h1>
          {/* FR-CON-02 / poc-scope 3.6: provenance is always visible. Trust behaviour is
              a large part of what the pilot is meant to observe, so the badge is not optional. */}
          <span
            style={{
              fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.09em',
              padding: '.16rem .45rem', borderRadius: 3,
              color: cert === 'certified' ? 'var(--good)' : 'var(--warn)',
              background: cert === 'certified' ? 'var(--good-bg)' : 'var(--warn-bg)',
            }}
          >
            {cert}
          </span>
        </div>
        <p style={{ margin: '.3rem 0 0', fontSize: '.78rem', color: 'var(--muted)' }}>
          {dash.meta.tailwind.description}
          {meta !== null && <> · bundle {meta.bundle_version} · freshness {dash.freshness.class}</>}
        </p>
      </header>

      {/* FR-VIZ-13. One failed chart does not stop the others rendering -- each card owns
          its own query -- but the page must not read as a complete picture either. Drawn
          through the same notice component as everything else, above the grid, where it
          is read before the numbers rather than after. */}
      <div style={{ marginBottom: '.5rem' }}>
        <NoticeList notices={incomplete === null ? [] : [incomplete]} />
      </div>

      {/* 12-column grid, straight from the spec's layout block. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gridAutoRows: '52px',
          gap: '.85rem',
        }}
      >
        {dash.charts.map((c) => (
          <ChartCard
            key={c.id}
            chart={c}
            dashboard={dash.name}
            freshness={dash.freshness.class}
            onStateChange={onChartState}
          />
        ))}
      </div>
    </main>
  );
}
