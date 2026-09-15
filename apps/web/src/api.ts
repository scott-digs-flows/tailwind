import type { Dashboard, DashboardChart, Notice } from '@tailwind/spec';
import type { ResultRow } from '@tailwind/charts';

const BASE: string = import.meta.env.VITE_API_BASE ?? '/api';

/**
 * ADR-006 D3. Every response carries this; the UI reads freshness and provenance from it.
 *
 * This shape is duplicated from apps/api rather than imported, so it can drift without
 * typecheck noticing. If you add a field there, add it here -- `notices` was added
 * precisely because a producing side shipped with no consuming surface.
 *
 * `Notice` itself is NOT duplicated any more: it moved to `@tailwind/spec` with TW-156,
 * because `packages/charts` renders notices (ADR-006 amendment, rule 2) and a renderer
 * switching on a code the producer has renamed fails by rendering nothing.
 */
export interface EnvelopeMeta {
  bundle_version: string;
  as_of: string | null;
  freshness: { class: string; stale: boolean | null; as_of_source: string; max_staleness_seconds: number };
  cache: string;
  trace_id: string;
  security_context_digest: string;
  /** ADR-006 amendment. Empty means "nothing to say"; severity >= warn MUST be shown. */
  notices: Notice[];
}
export interface Envelope<T> {
  meta: EnvelopeMeta;
  data: T;
}

/**
 * A failure the UI can render as-is (FR-VIZ-13).
 *
 * It carries the API's plain-language reason, never an exception's own message: the
 * `Error.message` of a failed `fetch` is `Failed to fetch`, and the API's is a sentence
 * written for a reader. The trace id comes along because "tell support this reference"
 * is the difference between a vague message and a supportable one (NFR-OPS-01), and an
 * opaque request id discloses nothing about the warehouse.
 */
export class QueryFailed extends Error {
  readonly reason: string;
  readonly traceId: string | null;
  readonly notices: Notice[];

  constructor(reason: string, traceId: string | null, notices: Notice[] = []) {
    super(reason);
    this.name = 'QueryFailed';
    this.reason = reason;
    this.traceId = traceId;
    this.notices = notices;
  }
}

/**
 * What the browser says when it never reached the API at all -- the server is down, the
 * network dropped, or something in front of us answered with HTML. The API cannot write
 * this sentence because the API is not there to write it, so it is the one piece of
 * plain language the client owns.
 */
const UNREACHABLE =
  'Tailwind could not be reached, so this chart has no number to show. ' +
  'Check your connection and try again.';

async function call<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    // Deliberately not `String(e)`: a DOMException's text is for a developer console.
    throw new QueryFailed(UNREACHABLE, null);
  }

  let body: (Envelope<T> & { data?: { error?: string } }) | null = null;
  try {
    body = (await res.json()) as Envelope<T> & { data?: { error?: string } };
  } catch {
    body = null;
  }

  if (!res.ok || body === null) {
    // The reason comes from the envelope, which the API writes in plain language. A
    // response with no envelope means something other than the API answered (a proxy
    // error page, say), and then the generic sentence is the honest one -- rendering
    // `HTTP 502` to someone reading a revenue chart is not a reason, it is a status.
    throw new QueryFailed(
      body?.data?.error ?? UNREACHABLE,
      body?.meta?.trace_id ?? null,
      body?.meta?.notices ?? [],
    );
  }
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
