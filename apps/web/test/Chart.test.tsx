import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ChartCard } from '../src/Chart';
import { kpiChart, okEnvelope, failedEnvelope, stubFetch, type PendingRequest } from './harness';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * "Shows no number."
 *
 * An element whose entire text is digits and separators is what a KPI renders, and what
 * nothing else on the card does -- the title is words, the reference id has letters in
 * it. So this is the assertion that a state which must not show a number is not showing
 * one, and it stays true if the card's layout changes around it.
 */
const aNumberIsOnScreen = (): boolean => screen.queryAllByText(/^-?[\d,.]+$/).length > 0;

/** Settle a pending request from inside `act`, so React has flushed before we assert. */
const settle = async (req: PendingRequest, body: unknown, status = 200): Promise<void> => {
  await act(async () => {
    req.resolve(body, status);
  });
};

test('a failed query says so in place, with a reason and a retry, and shows no number', async () => {
  const { requests } = stubFetch();
  render(<ChartCard chart={kpiChart('revenue', 'sales')} freshness="standard" />);

  await settle(
    requests[0]!,
    failedEnvelope(
      'The data warehouse could not be reached, so this chart has no number to show. ' +
        'Nothing is wrong with the chart itself -- try again in a moment.',
    ),
    503,
  );

  const alert = screen.getByRole('alert');
  expect(alert.textContent).toContain('could not be reached');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  // The support reference, which is the only internal detail that may be shown.
  expect(alert.textContent).toContain('trace-abc123');
  expect(aNumberIsOnScreen()).toBe(false);
  // Nothing dressed up as a status code or an exception.
  expect(alert.textContent).not.toMatch(/HTTP|503|Error:/);
});

test('a transport failure still produces a plain-language reason, not "Failed to fetch"', async () => {
  const { requests } = stubFetch();
  render(<ChartCard chart={kpiChart('revenue', 'sales')} freshness="standard" />);

  await act(async () => {
    requests[0]!.fail();
  });

  const alert = screen.getByRole('alert');
  expect(alert.textContent).toContain('Tailwind could not be reached');
  expect(alert.textContent).not.toContain('Failed to fetch');
});

test('a retry re-runs the query and replaces the failure with the number', async () => {
  const { requests } = stubFetch();
  render(<ChartCard chart={kpiChart('revenue', 'sales')} freshness="standard" />);
  await settle(requests[0]!, failedEnvelope('This chart took too long to return.'), 504);

  await act(async () => {
    screen.getByRole('button', { name: 'Try again' }).click();
  });

  expect(requests).toHaveLength(2);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('Loading');

  await settle(requests[1]!, okEnvelope([{ 'sales.revenue': 1234 }]));
  expect(screen.getByText('1,234')).toBeTruthy();
});

test('a late answer from the attempt that failed cannot overwrite the retry', async () => {
  const { requests } = stubFetch();
  render(<ChartCard chart={kpiChart('revenue', 'sales')} freshness="standard" />);
  await settle(requests[0]!, failedEnvelope('This chart took too long to return.'), 504);
  await act(async () => {
    screen.getByRole('button', { name: 'Try again' }).click();
  });

  // The first attempt answers after the second was asked for. It is a different
  // request, so its rows are not this chart's answer.
  await settle(requests[0]!, okEnvelope([{ 'sales.revenue': 999 }]));

  expect(screen.queryByText('999')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('Loading');
});

test('no rows says there is no data for these filters rather than drawing a zero', async () => {
  const { requests } = stubFetch();
  render(<ChartCard chart={kpiChart('revenue', 'sales')} freshness="standard" />);

  await settle(requests[0]!, okEnvelope([]));

  expect(screen.getByText('No data for these filters.')).toBeTruthy();
  // Without the empty state this reads `0`, which is a different and confident claim.
  expect(aNumberIsOnScreen()).toBe(false);
});

test('a result emptied by access policy says something different', async () => {
  const { requests } = stubFetch();
  render(<ChartCard chart={kpiChart('revenue', 'sales')} freshness="standard" />);

  await settle(
    requests[0]!,
    okEnvelope([], [{ code: 'empty_by_policy', severity: 'warn', message: 'Rows removed by policy.' }]),
  );

  expect(screen.getByText('No data you have access to matches these filters.')).toBeTruthy();
});

test('a chart that has not answered yet is visibly loading and shows no number', () => {
  stubFetch();
  render(<ChartCard chart={kpiChart('revenue', 'sales')} freshness="standard" />);

  const status = screen.getByRole('status');
  expect(status.getAttribute('aria-busy')).toBe('true');
  expect(status.textContent).toContain('Loading');
  expect(aNumberIsOnScreen()).toBe(false);
});

/**
 * FR-VIZ-13's sharpest clause, and the only one that cannot be tested on a first load:
 * *"rendering a previous query's result while a new one is in flight ... is a defect."*
 *
 * The filter changes, so the question changes. Until the new question is answered there
 * is no number this chart can stand behind -- and the old one, sitting under a current
 * as-of, is exactly the confident wrong number the product exists to prevent. Note that
 * the assertion is made synchronously after the props change, before anything settles:
 * a single paint showing the old value is the whole defect.
 */
test('changing the filters clears the previous number the moment the new query starts', async () => {
  const { requests } = stubFetch();
  const chart = kpiChart('revenue', 'sales');
  const { rerender } = render(<ChartCard chart={chart} freshness="standard" />);

  await settle(requests[0]!, okEnvelope([{ 'sales.revenue': 1234 }]));
  expect(screen.getByText('1,234')).toBeTruthy();
  expect(screen.getByText(/as of/)).toBeTruthy();

  const filtered = kpiChart('revenue', 'sales', [
    { member: 'sales.region', operator: 'equals', values: ['EMEA'] },
  ]);
  rerender(<ChartCard chart={filtered} freshness="standard" />);

  expect(screen.queryByText('1,234')).toBeNull();
  expect(aNumberIsOnScreen()).toBe(false);
  // The freshness footer goes with it: an as-of from the previous filter is a stale
  // claim wearing a fresh timestamp.
  expect(screen.queryByText(/as of/)).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('Loading');
  expect(requests).toHaveLength(2);

  await settle(requests[1]!, okEnvelope([{ 'sales.revenue': 42 }]));
  expect(screen.getByText('42')).toBeTruthy();
  expect(screen.queryByText('1,234')).toBeNull();
});

test('changing the freshness class is a new question too', async () => {
  const { requests } = stubFetch();
  const chart = kpiChart('revenue', 'sales');
  const { rerender } = render(<ChartCard chart={chart} freshness="standard" />);
  await settle(requests[0]!, okEnvelope([{ 'sales.revenue': 1234 }]));

  rerender(<ChartCard chart={chart} freshness="operational" />);

  expect(screen.queryByText('1,234')).toBeNull();
  expect(requests).toHaveLength(2);
  expect(requests[1]!.body?.freshness).toBe('operational');
});

test('a truncation notice is still rendered above the number it qualifies', async () => {
  const { requests } = stubFetch();
  render(<ChartCard chart={kpiChart('revenue', 'sales')} freshness="standard" />);

  await settle(
    requests[0]!,
    okEnvelope(
      [{ 'sales.revenue': 1234 }],
      [{ code: 'row_limit_reached', severity: 'warn', message: 'Showing the first 10,000 rows.' }],
    ),
  );

  expect(screen.getByText('Showing the first 10,000 rows.')).toBeTruthy();
  expect(screen.getByText('1,234')).toBeTruthy();
});
