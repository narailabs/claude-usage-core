import { describe, it, expect } from 'vitest';
import type { ExtraUsage } from '../src/types.js';
import { formatCredits, formatExtraUsageDisplay, isExtraUsageVisible, getExtraUtilizationPercent } from '../src/extra-usage.js';

const disabled: ExtraUsage = { isEnabled: false, monthlyLimit: null, usedCredits: null, utilization: null };
const enabledZero: ExtraUsage = { isEnabled: true, monthlyLimit: 50, usedCredits: 0, utilization: 0 };
const enabledActive: ExtraUsage = { isEnabled: true, monthlyLimit: 50, usedCredits: 5.2, utilization: 0.104 };
const enabledNulls: ExtraUsage = { isEnabled: true, monthlyLimit: null, usedCredits: null, utilization: null };

describe('formatCredits', () => {
  it('formats whole numbers', () => {
    expect(formatCredits(5)).toBe('$5.00');
  });

  it('formats decimals to two places', () => {
    expect(formatCredits(5.2)).toBe('$5.20');
    expect(formatCredits(5.256)).toBe('$5.26');
  });

  it('formats zero', () => {
    expect(formatCredits(0)).toBe('$0.00');
  });
});

describe('formatExtraUsageDisplay', () => {
  it('returns empty string when disabled', () => {
    expect(formatExtraUsageDisplay(disabled)).toBe('');
  });

  it('returns empty string when enabled but credits are null', () => {
    expect(formatExtraUsageDisplay(enabledNulls)).toBe('');
  });

  it('formats active usage', () => {
    expect(formatExtraUsageDisplay(enabledActive)).toBe('$5.20/$50.00');
  });

  it('formats zero usage', () => {
    expect(formatExtraUsageDisplay(enabledZero)).toBe('$0.00/$50.00');
  });
});

describe('isExtraUsageVisible', () => {
  it('returns false when disabled', () => {
    expect(isExtraUsageVisible(disabled)).toBe(false);
  });

  it('returns false when disabled even with force', () => {
    expect(isExtraUsageVisible(disabled, true)).toBe(false);
  });

  it('returns false when enabled with zero usage (no force)', () => {
    expect(isExtraUsageVisible(enabledZero)).toBe(false);
  });

  it('returns true when enabled with zero usage and force', () => {
    expect(isExtraUsageVisible(enabledZero, true)).toBe(true);
  });

  it('returns true when enabled with active usage', () => {
    expect(isExtraUsageVisible(enabledActive)).toBe(true);
  });

  it('returns true when enabled with active usage and force', () => {
    expect(isExtraUsageVisible(enabledActive, true)).toBe(true);
  });

  it('returns false when enabled but credits null (no force)', () => {
    expect(isExtraUsageVisible(enabledNulls)).toBe(false);
  });

  it('returns true when enabled but credits null with force', () => {
    expect(isExtraUsageVisible(enabledNulls, true)).toBe(true);
  });
});

describe('getExtraUtilizationPercent', () => {
  it('returns 0 when utilization is null', () => {
    expect(getExtraUtilizationPercent(disabled)).toBe(0);
  });

  it('returns 0 for zero utilization', () => {
    expect(getExtraUtilizationPercent(enabledZero)).toBe(0);
  });

  it('rounds to nearest integer', () => {
    expect(getExtraUtilizationPercent(enabledActive)).toBe(10);
  });

  it('handles high utilization', () => {
    expect(getExtraUtilizationPercent({ isEnabled: true, monthlyLimit: 50, usedCredits: 47.5, utilization: 0.95 })).toBe(95);
  });

  it('handles 100% utilization', () => {
    expect(getExtraUtilizationPercent({ isEnabled: true, monthlyLimit: 50, usedCredits: 50, utilization: 1.0 })).toBe(100);
  });
});
