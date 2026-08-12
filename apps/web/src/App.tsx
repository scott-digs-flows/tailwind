import { useEffect, useState } from 'react';

const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api';

/** Mirrors ADR-006 D3. Will move to packages/spec once T-012 lands. */
interface Envelope {
  meta: {
    bundle_version: string;
    as_of: string;
    freshness: { class: string; stale: boolean };
    cache: string;
    trace_id: string;
    security_context_digest: string;
  };
  data: { status: string; service: string };
}

export function App() {
  const [env, setEnv] = useState<Envelope | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/healthz`)
      .then((r) => (r.ok ? (r.json() as Promise<Envelope>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setEnv)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main style={{ fontFamily: 'ui-monospace, monospace', padding: '2rem', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: '1.1rem', margin: '0 0 1.5rem' }}>Tailwind — walking skeleton</h1>

      {error !== null && <p style={{ color: '#b00' }}>API unreachable: {error}</p>}
      {error === null && env === null && <p>Calling /healthz…</p>}

      {env !== null && (
        <table>
          <tbody>
            {/* The trace id is the point: it proves the envelope survived the hop. */}
            <Row label="trace_id" value={env.meta.trace_id} />
            <Row label="bundle_version" value={env.meta.bundle_version} />
            <Row label="as_of" value={env.meta.as_of} />
            <Row label="freshness" value={`${env.meta.freshness.class} (stale=${String(env.meta.freshness.stale)})`} />
            <Row label="cache" value={env.meta.cache} />
            <Row label="security_ctx" value={env.meta.security_context_digest} />
            <Row label="data" value={`${env.data.service}: ${env.data.status}`} />
          </tbody>
        </table>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ paddingRight: '1.5rem', opacity: 0.6 }}>{label}</td>
      <td>{value}</td>
    </tr>
  );
}
