import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { App } from '../src/App';
import {
  dashboard, failedEnvelope, kpiChart, okEnvelope, requestFor, stubFetch, type PendingRequest,
} from './harness';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settle = async (req: PendingRequest, body: unknown, status = 200): Promise<void> => {
  await act(async () => {
    req.resolve(body, status);
  });
};

/**
 * FR-VIZ-13's third criterion, which is the one a per-chart fix does not give you for
 * free: a dashboard is N independent queries, so five correct charts and one failure
 * render as a complete-looking page with a gap in it. The reader who scrolls past the
 * failed card -- or exports the page -- carries away a picture that is missing a term
 * and says nothing about it.
 */
test('one failed chart does not stop the others, and the dashboard says it is incomplete', async () => {
  const { requests } = stubFetch();
  render(<App />);

  await settle(requests[0]!, {
    meta: okEnvelope([]).meta,
    data: dashboard([kpiChart('revenue', 'sales'), kpiChart('orders', 'orders')]),
  });

  const sales = requestFor(requests, 'revenue');
  const orders = requestFor(requests, 'orders');
  expect(sales && orders).toBeTruthy();

  await settle(sales!, okEnvelope([{ 'sales.revenue': 1234 }]));
  await settle(
    orders!,
    failedEnvelope('This chart took too long to return and was stopped, so no number is shown.'),
    504,
  );

  // The chart that worked still shows its number...
  expect(screen.getByText('1,234')).toBeTruthy();
  // ...the one that did not says why, in its own card...
  const alerts = screen.getAllByRole('alert').map((el) => el.textContent ?? '');
  expect(alerts.some((t) => t.includes('took too long'))).toBe(true);
  // ...and the page as a whole admits it does not add up.
  expect(alerts.some((t) => /1 of 2 charts could not be loaded/.test(t))).toBe(true);
  expect(alerts.some((t) => t.includes('incomplete'))).toBe(true);
});

test('a dashboard whose charts all answer says nothing extra', async () => {
  const { requests } = stubFetch();
  render(<App />);

  await settle(requests[0]!, {
    meta: okEnvelope([]).meta,
    data: dashboard([kpiChart('revenue', 'sales'), kpiChart('orders', 'orders')]),
  });
  await settle(requestFor(requests, 'revenue')!, okEnvelope([{ 'sales.revenue': 1234 }]));
  await settle(requestFor(requests, 'orders')!, okEnvelope([{ 'orders.revenue': 7 }]));

  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('1,234')).toBeTruthy();
});

test('a dashboard still loading does not accuse its charts of having failed', async () => {
  const { requests } = stubFetch();
  render(<App />);

  await settle(requests[0]!, {
    meta: okEnvelope([]).meta,
    data: dashboard([kpiChart('revenue', 'sales'), kpiChart('orders', 'orders')]),
  });

  expect(screen.queryByText(/could not be loaded/)).toBeNull();
  expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
});

test('a dashboard that cannot be opened says so in plain language', async () => {
  const { requests } = stubFetch();
  render(<App />);

  await settle(
    requests[0]!,
    failedEnvelope('This dashboard could not be opened. It may have been renamed or not yet published.'),
    404,
  );

  expect(screen.getByRole('alert').textContent).toContain('could not be opened');
  // Not the validator's output, which carries the artifact's path on disk.
  expect(screen.getByRole('alert').textContent).not.toMatch(/content\/tenants|\.yml/);
});
