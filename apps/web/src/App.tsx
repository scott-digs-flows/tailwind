import { useEffect, useState } from 'react';
import type { Dashboard } from '@tailwind/spec';
import { fetchDashboard, type EnvelopeMeta } from './api';
import { ChartCard } from './Chart';

const DASHBOARD = 'sales_overview';

export function App() {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [meta, setMeta] = useState<EnvelopeMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboard(DASHBOARD)
      .then((env) => {
        setDash(env.data);
        setMeta(env.meta);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error !== null) return <main style={{ padding: '2rem' }}><p style={{ color: 'var(--bad)' }}>{error}</p></main>;
  if (dash === null) return <main style={{ padding: '2rem', opacity: 0.6 }}>loading dashboard…</main>;

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
          <ChartCard key={c.id} chart={c} freshness={dash.freshness.class} />
        ))}
      </div>
    </main>
  );
}
