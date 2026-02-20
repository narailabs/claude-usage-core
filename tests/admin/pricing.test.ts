// tests/admin/pricing.test.ts
import { describe, it, expect } from 'vitest';
import { estimateCostCents } from '../../src/admin/pricing.js';

describe('estimateCostCents', () => {
  it('computes cost for sonnet 4 (base input only)', () => {
    // 1M uncached input tokens at $3/MTok = 300 cents
    const cost = estimateCostCents('claude-sonnet-4-20250514', 1_000_000, 0, 0, 0, 0);
    expect(cost).toBeCloseTo(300, 5);
  });

  it('computes cost for sonnet 4 (output only)', () => {
    // 1M output tokens at $15/MTok = 1500 cents
    const cost = estimateCostCents('claude-sonnet-4-20250514', 0, 0, 0, 0, 1_000_000);
    expect(cost).toBeCloseTo(1500, 5);
  });

  it('computes cost for sonnet 4 (5m cache write)', () => {
    // 1M 5m-cache-write tokens at $3 * 1.25 = $3.75/MTok = 375 cents
    const cost = estimateCostCents('claude-sonnet-4-20250514', 0, 0, 1_000_000, 0, 0);
    expect(cost).toBeCloseTo(375, 5);
  });

  it('computes cost for sonnet 4 (1h cache write)', () => {
    // 1M 1h-cache-write tokens at $3 * 2 = $6/MTok = 600 cents
    const cost = estimateCostCents('claude-sonnet-4-20250514', 0, 0, 0, 1_000_000, 0);
    expect(cost).toBeCloseTo(600, 5);
  });

  it('computes cost for sonnet 4 (cache read)', () => {
    // 1M cache-read tokens at $3 * 0.1 = $0.30/MTok = 30 cents
    const cost = estimateCostCents('claude-sonnet-4-20250514', 0, 1_000_000, 0, 0, 0);
    expect(cost).toBeCloseTo(30, 5);
  });

  it('computes cost for opus 4.6', () => {
    // $5/MTok input, $25/MTok output
    const cost = estimateCostCents('claude-opus-4-6-20260101', 1_000_000, 0, 0, 0, 1_000_000);
    expect(cost).toBeCloseTo(500 + 2500, 5);
  });

  it('computes cost for opus 4 (higher tier)', () => {
    // $15/MTok input, $75/MTok output
    const cost = estimateCostCents('claude-opus-4-20250514', 1_000_000, 0, 0, 0, 1_000_000);
    expect(cost).toBeCloseTo(1500 + 7500, 5);
  });

  it('differentiates opus 4.5 from opus 4', () => {
    const cost45 = estimateCostCents('claude-opus-4-5-20260101', 1_000_000, 0, 0, 0, 0);
    const cost4 = estimateCostCents('claude-opus-4-20250514', 1_000_000, 0, 0, 0, 0);
    // Opus 4.5 = $5/MTok, Opus 4 = $15/MTok
    expect(cost45).toBeCloseTo(500, 5);
    expect(cost4).toBeCloseTo(1500, 5);
  });

  it('computes cost for haiku 4.5', () => {
    // $1/MTok input, $5/MTok output
    const cost = estimateCostCents('claude-haiku-4-5-20251001', 1_000_000, 0, 0, 0, 1_000_000);
    expect(cost).toBeCloseTo(100 + 500, 5);
  });

  it('computes cost for haiku 3.5', () => {
    // $0.80/MTok input, $4/MTok output
    const cost = estimateCostCents('claude-3-5-haiku-20241022', 1_000_000, 0, 0, 0, 1_000_000);
    expect(cost).toBeCloseTo(80 + 400, 5);
  });

  it('returns 0 for unknown model', () => {
    const cost = estimateCostCents('unknown-model', 1_000_000, 0, 0, 0, 1_000_000);
    expect(cost).toBe(0);
  });

  it('combines all token types correctly', () => {
    // Sonnet 4: input=$3, 5m-write=$3.75, 1h-write=$6, cache-read=$0.30, output=$15 (all per MTok)
    const cost = estimateCostCents(
      'claude-sonnet-4-20250514',
      100_000,  // uncached input: 0.1M * 300 = 30
      50_000,   // cache read:     0.05M * 30 = 1.5
      20_000,   // 5m cache write: 0.02M * 375 = 7.5
      10_000,   // 1h cache write: 0.01M * 600 = 6
      80_000,   // output:         0.08M * 1500 = 120
    );
    expect(cost).toBeCloseTo(30 + 1.5 + 7.5 + 6 + 120, 5);
  });
});
