import { vi } from 'vitest';
import type { Dashboard, DashboardChart, Notice } from '@tailwind/spec';

/**
 * A `fetch` that does not settle until a test says so.
 *
 * FR-VIZ-13 is largely a claim about the gap between asking and answering -- what is on
 * screen while a query is in flight, and what is on screen when the query before it has
 * already answered. A mock that resolves immediately cannot express that gap, so every
 * request here stays pending until the test resolves it by hand.
 *
 * `window.fetch` is stubbed rather than `./src/api`, so the real client runs: its
 * mapping of a non-2xx envelope onto a plain-language reason is part of what these
 * tests are checking, not scaffolding around it.
 */
export interface PendingRequest {
  url: string;
  body: { query?: { view?: string; filters?: unknown[] }; freshness?: string } | null;
  resolve: (response: unknown, status?: number) => void;
  /** The transport itself failing: no response, no envelope, no reason from the API. */
  fail: () => void;
}

export function stubFetch(): { requests: PendingRequest[] } {
  const requests: PendingRequest[] = [];

  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    return new Promise<unknown>((resolve, reject) => {
      requests.push({
        url,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
        resolve: (response: unknown, status = 200) =>
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: async () => response,
          }),
        fail: () => reject(new TypeError('Failed to fetch')),
      });
    });
  });

  return { requests };
}

/** Finds the pending query for a chart, by the view its query names. */
export const requestFor = (requests: PendingRequest[], view: string): PendingRequest | undefined =>
  requests.find((r) => r.body?.query?.view === view);

export const meta = (over: Partial<Record<string, unknown>> = {}) => ({
  bundle_version: 'test-bundle',
  as_of: '2026-09-15T08:00:00.000Z',
  freshness: { class: 'standard', stale: false, as_of_source: 'engine', max_staleness_seconds: 1800 },
  cache: 'bypass',
  trace_id: 'trace-abc123',
  security_context_digest: 'sha256:test',
  notices: [] as Notice[],
  ...over,
});

export const okEnvelope = (
  rows: Record<string, unknown>[],
  notices: Notice[] = [],
): Record<string, unknown> => ({
  meta: meta({ notices }),
  data: { rows, sql: 'SELECT sum(amount) FROM sales' },
});

/** What the API returns when a query fails: a plain-language reason, in both places. */
export const failedEnvelope = (reason: string): Record<string, unknown> => ({
  meta: meta({ notices: [{ code: 'query_failed', severity: 'error', message: reason }] }),
  data: { error: reason },
});

export const kpiChart = (id: string, view: string, filters?: { member: string; operator: 'equals'; values: string[] }[]): DashboardChart => ({
  id,
  title: `${id} title`,
  type: 'kpi',
  layout: { x: 0, y: 0, w: 3, h: 2 },
  query: { view, metrics: [`${view}.revenue`], ...(filters ? { filters } : {}) },
});

export const dashboard = (charts: DashboardChart[]): Dashboard => ({
  spec_version: 1,
  name: 'sales_overview',
  title: 'Sales overview',
  freshness: { class: 'standard' },
  meta: {
    tailwind: {
      spec_version: 1,
      owner: 'data-team',
      description: 'Pilot dashboard',
      certification: 'certified',
      last_reviewed: '2026-09-01',
    },
  },
  charts,
});
