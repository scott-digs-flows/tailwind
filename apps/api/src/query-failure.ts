import type { Notice, NoticeCode } from '@tailwind/spec';

/**
 * FR-VIZ-13. Turn whatever went wrong into something a business user can act on,
 * without telling them anything they should not see.
 *
 * Until TW-156 the query route returned `e.message` straight to the browser, and the
 * chart printed it. Three things are wrong with that, in increasing order of cost:
 *
 *   1. The messages are not English for a reader. `Cube error (HTTP 500)` tells someone
 *      looking at a revenue chart nothing they can do.
 *   2. They name the engine and can quote the generated SQL -- `cube-client.ts` puts up
 *      to 200 characters of the engine's response body into the message, and the engine
 *      quotes the failing query back. That is vendor detail leaking past the facade
 *      (ADR-006 D4) and warehouse schema leaking to a browser (NFR-SEC-05).
 *   3. A raw message is not a code, so no surface can behave differently for a timeout
 *      than for a broken model, and nothing can be counted in a dashboard.
 *
 * So the translation happens once, here, on the only side that knows what actually
 * happened -- and the raw error goes to the log with the trace id, which is what makes
 * the plain-language version supportable rather than merely vague (NFR-OPS-01).
 *
 * The classification is deliberately coarse. Three things a reader can act on
 * differently (wait, tell the data team, try again) plus a catch-all; a finer taxonomy
 * built on matching engine strings would be a promise about someone else's error text.
 */
export interface QueryFailure {
  /** For the envelope's notice, and for anything counting failures by kind. */
  code: NoticeCode;
  /**
   * HTTP status. Honest, but not load-bearing: ADR-006's amendment says nothing may be
   * communicated by status alone, so the notice carries the same fact and every client
   * reads it from there.
   */
  status: number;
  /** Plain language. No status codes, no engine names, no SQL, no file paths. */
  message: string;
}

const TIMEOUT: QueryFailure = {
  code: 'query_timeout',
  status: 504,
  message:
    'This chart took too long to return and was stopped, so no number is shown. ' +
    'Try again, or narrow the filters to cover less data.',
};

const UNREACHABLE: QueryFailure = {
  code: 'query_failed',
  status: 503,
  message:
    'The data warehouse could not be reached, so this chart has no number to show. ' +
    'Nothing is wrong with the chart itself -- try again in a moment.',
};

/**
 * The model no longer defines what the chart asks for: a member renamed or removed, a
 * view a chart may not reference (FR-SEM-02), a freshness class that is not one of the
 * three (FR-FRESH-02). Retrying cannot fix any of these, so the message says who can.
 */
const DEFINITION: QueryFailure = {
  code: 'query_failed',
  status: 400,
  message:
    'This chart asks for something the published model does not define, so it cannot be ' +
    'calculated. It needs an update from the data team.',
};

const UNKNOWN: QueryFailure = {
  code: 'query_failed',
  status: 500,
  message:
    'Something went wrong while calculating this chart, so no number is shown. ' +
    'The failure has been logged with the reference below.',
};

/**
 * Matched against the message we raise ourselves, not against the engine's prose.
 *
 * `cube-client.ts` raises both of these (`Cube did not finish within 30000ms`, and the
 * fetch rejection when the endpoint is down), and `facade.ts` raises the FR-SEM-02 and
 * FR-FRESH-02 refusals. Everything else lands on UNKNOWN by design: guessing from a
 * vendor's error text is how a classifier silently stops classifying after an upgrade,
 * and UNKNOWN is a safe place to land -- it says less, and says nothing false.
 */
export function classifyQueryFailure(error: unknown): QueryFailure {
  const text = error instanceof Error ? error.message : String(error);

  if (/did not finish within|Continue wait|timed? ?out|ETIMEDOUT/i.test(text)) return TIMEOUT;
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|socket hang up/i.test(text)) {
    return UNREACHABLE;
  }
  // Matched on the requirement IDs our own refusals carry, which is the most stable
  // thing about them: the prose around them can be reworded without this going quiet.
  if (/FR-SEM-02|FR-SEM-14|FR-FRESH-02/.test(text)) return DEFINITION;
  return UNKNOWN;
}

/**
 * The failure as a notice, so a failed query reaches the client through the same
 * channel as a degraded one (ADR-006 amendment, rule 1). A client that renders notices
 * therefore renders failures too, with no second code path to forget.
 */
export const failureNotice = (failure: QueryFailure): Notice => ({
  code: failure.code,
  severity: 'error',
  message: failure.message,
});
