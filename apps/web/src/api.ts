import type { Dashboard, DashboardChart } from '@tailwind/spec';
import type { ResultRow } from '@tailwind/charts';

const BASE: string = import.meta.env.VITE_API_BASE ?? '/api';

/** ADR-006 D3. Every response carries this; the UI reads freshness and provenance from it. */
export interface EnvelopeMeta {
  bundle_version: string;
  as_of: string;
  freshness: { class: string; stale: boolean };
  cache: string;
  trace_id: string;
  security_context_digest: string;
}
export interface Envelope<T> {
  meta: EnvelopeMeta;
  data: T;
}

async function call<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json()) as Envelope<T> & { data?: { error?: string } };
  if (!res.ok) throw new Error(body.data?.error ?? `HTTP ${res.status}`);
  return body;
}

export const fetchDashboard = (name: string): Promise<Envelope<Dashboard>> =>
  call<Dashboard>(`/v1/dashboards/${name}`);

export interface QueryData {
  rows: ResultRow[];
  sql: string;
}

export const runChartQuery = (chart: DashboardChart, freshness: string): Promise<Envelope<QueryData>> =>
  call<QueryData>('/v1/queries', {
    method: 'POST',
    body: JSON.stringify({ query: chart.query, freshness }),
  });
