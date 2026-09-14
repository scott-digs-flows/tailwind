import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cachePolicyFor, freshnessReport, DEFAULT_FRESHNESS } from '../src/index.ts';

test('the class drives cache behaviour — authors never configure caching (FR-FRESH-02)', () => {
  assert.equal(cachePolicyFor('batch').ttlSeconds, 86400);
  assert.equal(cachePolicyFor('standard').ttlSeconds, 1800);
  // Near-live has no meaningful result cache; a blended hit-rate target across classes
  // is meaningless, which is why NFR-SCALE-03 is stated per class.
  assert.equal(cachePolicyFor('operational').ttlSeconds, 0);
});

test('only batch pre-warms; only batch and standard invalidate on upstream refresh', () => {
  assert.equal(cachePolicyFor('batch').prewarm, true);
  assert.equal(cachePolicyFor('standard').prewarm, false);
  assert.equal(cachePolicyFor('operational').invalidateOnUpstreamRefresh, false);
});

test('an unspecified class defaults to standard (FR-FRESH-01)', () => {
  assert.equal(cachePolicyFor(undefined).class, DEFAULT_FRESHNESS);
  assert.equal(DEFAULT_FRESHNESS, 'standard');
});

test('an unknown as-of is reported as unknown, NOT as the request time', () => {
  const r = freshnessReport('standard', undefined);
  assert.equal(r.asOf, null, 'null, not now(): claiming data is as fresh as the request is a lie');
  assert.equal(r.asOfSource, 'unknown');
  assert.equal(r.stale, null, 'absence of information is not evidence of freshness');
});

test('a known as-of within the class budget is not stale', () => {
  const now = new Date('2026-08-13T12:00:00Z');
  const r = freshnessReport('standard', '2026-08-13T11:45:00Z', now); // 15 min, budget 30
  assert.equal(r.stale, false);
  assert.equal(r.asOfSource, 'engine');
});

test('a known as-of beyond the class budget is stale', () => {
  const now = new Date('2026-08-13T12:00:00Z');
  assert.equal(freshnessReport('standard', '2026-08-13T11:00:00Z', now).stale, true, '60 min > 30 min budget');
  // Same age, looser class: batch tolerates it.
  assert.equal(freshnessReport('batch', '2026-08-13T11:00:00Z', now).stale, false);
  // Same age, tighter class: operational does not.
  assert.equal(freshnessReport('operational', '2026-08-13T11:58:59Z', now).stale, true, '61s > 60s budget');
});

test('exactly at the budget is NOT stale — the budget is inclusive', () => {
  const now = new Date('2026-08-13T12:00:00Z');
  // Decided, not accidental: a class promising "within 30 minutes" is honoured AT
  // thirty minutes. Data exactly at the boundary has met the promise.
  assert.equal(freshnessReport('standard', '2026-08-13T11:30:00Z', now).stale, false);
  assert.equal(freshnessReport('operational', '2026-08-13T11:59:00Z', now).stale, false);
});
