import type { Notice } from '@tailwind/spec';
import type { ResultRow } from './index.ts';

/**
 * FR-VIZ-13. Which of a chart's four states is the honest one, as a pure function.
 *
 * This is in the adapter, next to `toEChartsOption`, for the reason ADR-005 D2 gives
 * for the adapter existing at all: the browser and the headless renderer (T-129) must
 * produce the SAME picture or the CI screenshot on a PR stops being evidence. A state
 * decision made inside a React component is a decision `apps/render` cannot reach, and
 * the amendment to ADR-006 is explicit about which direction that lies in -- the
 * screenshot comes out *cleaner* than what the user saw, which is the worst direction
 * for the evidence pipeline to be wrong in.
 *
 * It decides nothing about numbers. `toKpi` on an empty result returns a formatted `0`
 * -- correct as arithmetic, and a confident wrong number on a screen -- so the guard
 * has to sit in front of the adapter's formatters rather than inside them.
 */

/** What a surface knows about the query for the chart it is rendering RIGHT NOW. */
export interface ChartOutcome {
  /**
   * The rows of the query currently being displayed, or `null` when no query has
   * settled for the inputs on screen.
   *
   * `null` is load-bearing and is the whole of FR-VIZ-13's last clause: when the
   * filters change, the previous query's rows are not "the rows we have for a moment
   * longer", they are a different question's answer. A caller that leaves them here
   * while a new query is in flight renders a number that looks current and is not.
   * `outcomeFor` in `apps/web/src/chart-state.ts` is what enforces that for the browser.
   */
  rows: ResultRow[] | null;
  /** A plain-language failure from the API, or `null`. Never an engine message. */
  failure: string | null;
  notices: readonly Notice[];
}

export type ChartState =
  | { kind: 'loading' }
  /** No number is shown. `message` is what the reader is told instead. */
  | { kind: 'failed'; message: string }
  | { kind: 'empty'; message: string }
  | { kind: 'data'; rows: ResultRow[] };

/**
 * What an empty result says. Two messages, because `rows: []` genuinely has two causes
 * and ADR-006's amendment says so: "the filter matched nothing" is a fact about the
 * data, "row-level security removed everything you could have seen" is a fact about the
 * reader. Telling someone the second is the first produces a false "this number looks
 * wrong" report, which is the signal `00-vision.md §8`'s correction rate depends on.
 */
export const NO_ROWS_MESSAGE = 'No data for these filters.';
export const NO_VISIBLE_ROWS_MESSAGE = 'No data you have access to matches these filters.';

/** The fallback when a surface has a failure but no reason to give. Still not a status code. */
export const UNEXPLAINED_FAILURE_MESSAGE =
  'This chart could not be loaded, so no number is shown.';

export function chartState(outcome: ChartOutcome): ChartState {
  // Failure wins over rows, always. If a surface ever holds both -- a previous result
  // and a fresh failure -- the rows are stale by definition and drawing them is the
  // defect FR-VIZ-13 names.
  if (outcome.failure !== null) {
    return { kind: 'failed', message: outcome.failure || UNEXPLAINED_FAILURE_MESSAGE };
  }
  if (outcome.rows === null) return { kind: 'loading' };
  if (outcome.rows.length === 0) {
    const byPolicy = outcome.notices.some((n) => n.code === 'empty_by_policy');
    return { kind: 'empty', message: byPolicy ? NO_VISIBLE_ROWS_MESSAGE : NO_ROWS_MESSAGE };
  }
  return { kind: 'data', rows: outcome.rows };
}

/**
 * The notices a surface MUST render (ADR-006 amendment, rule 3: severity >= `warn`).
 *
 * One exported predicate rather than a `.filter()` per component: "must be rendered" is
 * a contract on every surface, and the component that writes the condition slightly
 * differently is the one that renders a clean chart over a degraded result.
 */
export const visibleNotices = (notices: readonly Notice[]): Notice[] =>
  notices.filter((n) => n.severity !== 'info');

/**
 * The notices a chart in this state must render, ordered so the worst is read first.
 *
 * A failed chart's own reason is already its whole body, so re-stating it as a banner
 * would say the same sentence twice; everything else (truncation, staleness) still
 * belongs above the chart, where a caveat is read BEFORE the number rather than after
 * it has been believed.
 */
export function chartNotices(state: ChartState, notices: readonly Notice[]): Notice[] {
  if (state.kind === 'failed') return [];
  const rank = { error: 0, warn: 1, info: 2 } as const;
  return visibleNotices(notices).sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/**
 * The dashboard-level statement that the page does not add up.
 *
 * A dashboard is N independent chart queries (ADR-006 D3), so nothing above them knows
 * they failed unless the charts say so. Without this, five correct charts and one
 * failure read as a complete dashboard with a gap in it -- and a reader who scrolls
 * past the failed card, or exports the page, carries away a total that is missing a
 * term. The count is in the message because "some charts failed" is not actionable and
 * "3 of 6" is.
 *
 * Returned as a `Notice` rather than a string so the dashboard header renders it
 * through the same component as every other notice: one channel for degradation
 * (ADR-006 amendment, rule 1), not a second one that happens to live higher up the page.
 */
export function dashboardIncompleteNotice(
  // Structural on purpose: the dashboard needs a tally, not the charts' contents, so a
  // surface that tracks only each chart's kind can call this without reassembling
  // messages and rows it does not have.
  states: readonly { kind: ChartState['kind'] }[],
): Notice | null {
  const failed = states.filter((s) => s.kind === 'failed').length;
  if (failed === 0) return null;
  // Agrees with the TOTAL, not the failure count: "1 of 2 charts", never "1 of 2 chart".
  const charts = states.length === 1 ? 'chart' : 'charts';
  return {
    code: 'partial_failure',
    severity: 'error',
    message:
      `${failed} of ${states.length} ${charts} could not be loaded. ` +
      `This dashboard is incomplete -- do not read it as a whole picture.`,
  };
}
