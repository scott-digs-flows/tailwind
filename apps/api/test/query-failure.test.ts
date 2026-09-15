import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyQueryFailure, failureNotice } from '../src/query-failure.ts';

/**
 * The messages the engine client and the facade actually raise, copied verbatim. If one
 * of them is reworded, this file is where the classifier stops recognising it -- which
 * is the point: the alternative is finding out from a dashboard that says
 * "something went wrong" when it could have said "try again in a moment".
 */
const REAL_ERRORS = {
  timeout: 'Cube did not finish within 30000ms (still "Continue wait")',
  unreachable: 'fetch failed',
  outsideView:
    "member 'orders.revenue' is outside view 'sales'; dashboards may reference views only (FR-SEM-02)",
  noContext: 'compile() requires a resolved SecurityContext (FR-SEM-14)',
  badFreshness: "a query requires a FreshnessClass, got 'live' (FR-FRESH-02)",
  engine500:
    'Cube error (HTTP 500): Error: Table sales_fact_v2 does not exist. ' +
    'SELECT "sales__revenue" FROM (SELECT sum(amount) ...) LIMIT 10001',
};

test('a query that ran out of time says to wait or narrow, and is a timeout', () => {
  const f = classifyQueryFailure(new Error(REAL_ERRORS.timeout));
  assert.equal(f.code, 'query_timeout');
  assert.equal(f.status, 504);
  assert.match(f.message, /took too long/);
});

test('an unreachable warehouse is separated from a broken chart, because the advice differs', () => {
  const f = classifyQueryFailure(new Error(REAL_ERRORS.unreachable));
  assert.equal(f.status, 503);
  assert.match(f.message, /Nothing is wrong with the chart itself/);
});

test('a chart asking for something the model no longer defines names the data team', () => {
  for (const raw of [REAL_ERRORS.outsideView, REAL_ERRORS.noContext, REAL_ERRORS.badFreshness]) {
    const f = classifyQueryFailure(new Error(raw));
    assert.equal(f.status, 400, raw);
    assert.match(f.message, /data team/, raw);
  }
});

test('an unrecognised engine error lands on the generic reason rather than guessing', () => {
  const f = classifyQueryFailure(new Error(REAL_ERRORS.engine500));
  assert.equal(f.code, 'query_failed');
  assert.equal(f.status, 500);
});

/**
 * NFR-SEC-05 / FR-VIZ-13. The reason this module exists at all: `cube-client.ts` puts
 * up to 200 characters of the engine's response into its message, and the engine quotes
 * the failing SQL back. None of that may reach a browser.
 */
test('nothing from the raw error survives into what the reader is shown', () => {
  for (const raw of Object.values(REAL_ERRORS)) {
    const { message } = classifyQueryFailure(new Error(raw));
    for (const leak of ['Cube', 'SELECT', 'sales_fact_v2', 'HTTP', 'FR-SEM', 'FR-FRESH', 'compile(']) {
      assert.ok(
        !message.includes(leak),
        `"${leak}" leaked into a user-facing message for: ${raw}`,
      );
    }
    // Not a status code, not an exception's text: a sentence, ending like one.
    assert.match(message, /^[A-Z].*[.]$/s);
  }
});

test('a thrown non-Error is classified rather than stringified into the UI', () => {
  const f = classifyQueryFailure({ toString: () => 'SELECT 1 blew up' });
  assert.equal(f.code, 'query_failed');
  assert.ok(!f.message.includes('SELECT'));
});

test('the failure travels as a notice, so a client renders it through the one channel', () => {
  const notice = failureNotice(classifyQueryFailure(new Error(REAL_ERRORS.timeout)));
  assert.equal(notice.severity, 'error');
  assert.equal(notice.code, 'query_timeout');
  assert.match(notice.message, /took too long/);
});
