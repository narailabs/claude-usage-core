// tests/usage/index.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchUsage, transformUsageData } from '../../src/usage/index.js';

describe('fetchUsage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns usage data on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        five_hour: { utilization: 0.45, resets_at: '2025-01-01T05:00:00Z' },
        seven_day: { utilization: 0.30, resets_at: '2025-01-07T00:00:00Z' },
        seven_day_opus: null,
      }),
    }));

    const result = await fetchUsage('tok');
    expect(result.five_hour.utilization).toBe(0.45);
  });

  it('throws AuthenticationError on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' }));
    await expect(fetchUsage('tok')).rejects.toMatchObject({ name: 'AuthenticationError' });
  });

  it('throws generic error on other failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' }));
    await expect(fetchUsage('tok')).rejects.toThrow('API error: 500');
  });
});

describe('transformUsageData', () => {
  it('transforms raw API response with all windows', () => {
    const raw = {
      five_hour: { utilization: 0.45, resets_at: '2025-01-01T05:00:00Z' },
      seven_day: { utilization: 0.30, resets_at: null },
      seven_day_opus: { utilization: 0.10, resets_at: '2025-01-07T00:00:00Z' },
      seven_day_sonnet: { utilization: 0.12, resets_at: '2025-01-07T00:00:00Z' },
      seven_day_oauth_apps: null,
      seven_day_cowork: null,
      iguana_necktie: null,
      extra_usage: { is_enabled: true, monthly_limit: 100, used_credits: 25, utilization: 0.25 },
    };
    const result = transformUsageData(raw);
    expect(result.session.percent).toBe(0.45);
    expect(result.session.resetsAt).toBeInstanceOf(Date);
    expect(result.weekly.resetsAt).toBeNull();
    expect(result.opus?.percent).toBe(0.10);
    expect(result.sonnet?.percent).toBe(0.12);
    expect(result.oauthApps).toBeNull();
    expect(result.cowork).toBeNull();
    expect(result.iguanaNecktie).toBeNull();
    expect(result.extraUsage.isEnabled).toBe(true);
    expect(result.extraUsage.monthlyLimit).toBe(100);
    expect(result.extraUsage.usedCredits).toBe(25);
    expect(result.extraUsage.utilization).toBe(0.25);
  });

  it('returns null for opus when not present', () => {
    const raw = {
      five_hour: { utilization: 0, resets_at: null },
      seven_day: { utilization: 0, resets_at: null },
    };
    const result = transformUsageData(raw);
    expect(result.opus).toBeNull();
    expect(result.sonnet).toBeNull();
    expect(result.extraUsage.isEnabled).toBe(false);
  });
});
