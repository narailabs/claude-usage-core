// tests/admin/index.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchClaudeCodeUsage, transformClaudeCodeUsage } from '../../src/admin/index.js';
import { AuthenticationError } from '../../src/errors.js';
import type { RawClaudeCodeEntry } from '../../src/admin/index.js';

const MOCK_ENTRIES: RawClaudeCodeEntry[] = [
  {
    date: '2026-02-15',
    actor: { api_actor: { api_key_name: 'my-key' } },
    customer_type: 'api',
    model_breakdown: [
      {
        model: 'claude-sonnet-4-20250514',
        tokens: { input: 5000, output: 1000, cache_creation: 200, cache_read: 300 },
        estimated_cost: { amount: 150, currency: 'cents' },
      },
      {
        model: 'claude-haiku-4-5-20251001',
        tokens: { input: 2000, output: 500, cache_creation: 0, cache_read: 0 },
        estimated_cost: { amount: 25, currency: 'cents' },
      },
    ],
  },
  {
    date: '2026-02-16',
    actor: { user_actor: { email: 'user@example.com' } },
    customer_type: 'subscription',
    model_breakdown: [
      {
        model: 'claude-sonnet-4-20250514',
        tokens: { input: 3000, output: 800, cache_creation: 100, cache_read: 50 },
        estimated_cost: { amount: 95, currency: 'cents' },
      },
    ],
  },
  {
    date: '2026-02-16',
    actor: { api_actor: { api_key_name: 'my-key' } },
    customer_type: 'api',
    model_breakdown: [
      {
        model: 'claude-sonnet-4-20250514',
        tokens: { input: 1000, output: 200, cache_creation: 50, cache_read: 10 },
        estimated_cost: { amount: 30, currency: 'cents' },
      },
    ],
  },
];

describe('fetchClaudeCodeUsage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('fetches usage data successfully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: MOCK_ENTRIES, has_more: false, next_page: null }),
    }));
    const entries = await fetchClaudeCodeUsage('sk-ant-admin-test');
    expect(entries).toHaveLength(3);
    expect(entries[0].date).toBe('2026-02-15');
  });

  it('sends correct headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], has_more: false, next_page: null }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await fetchClaudeCodeUsage('sk-ant-admin-test');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/v1/organizations/usage_report/claude_code');
    expect(init.headers['x-api-key']).toBe('sk-ant-admin-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('passes starting_at parameter', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], has_more: false, next_page: null }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await fetchClaudeCodeUsage('sk-ant-admin-test', '2026-01-01');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('starting_at=2026-01-01');
  });

  it('defaults starting_at to first of current month', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], has_more: false, next_page: null }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await fetchClaudeCodeUsage('sk-ant-admin-test');

    const [url] = mockFetch.mock.calls[0];
    const now = new Date();
    const expectedStart = `${now.toISOString().slice(0, 8)}01`;
    expect(url).toContain(`starting_at=${expectedStart}`);
  });

  it('handles pagination', async () => {
    const page1 = [MOCK_ENTRIES[0]];
    const page2 = [MOCK_ENTRIES[1]];
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: page1, has_more: true, next_page: 'page2token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: page2, has_more: false, next_page: null }),
      });
    vi.stubGlobal('fetch', mockFetch);
    const entries = await fetchClaudeCodeUsage('sk-ant-admin-test');

    expect(entries).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [secondUrl] = mockFetch.mock.calls[1];
    expect(secondUrl).toContain('page=page2token');
  });

  it('throws AuthenticationError on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' }));
    await expect(fetchClaudeCodeUsage('bad-key')).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('throws error with API message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({ error: { message: 'Insufficient permissions' } }),
    }));
    await expect(fetchClaudeCodeUsage('sk-ant-admin-test')).rejects.toThrow('Insufficient permissions');
  });

  it('throws generic error when no API message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: async () => ({}),
    }));
    await expect(fetchClaudeCodeUsage('sk-ant-admin-test')).rejects.toThrow('Admin API error: 500 Server Error');
  });
});

describe('transformClaudeCodeUsage', () => {
  it('aggregates tokens across all entries', () => {
    const result = transformClaudeCodeUsage(MOCK_ENTRIES, 'Org');
    expect(result.accountName).toBe('Org');
    expect(result.inputTokens).toBe(5000 + 2000 + 3000 + 1000);
    expect(result.outputTokens).toBe(1000 + 500 + 800 + 200);
    expect(result.cacheCreationTokens).toBe(200 + 0 + 100 + 50);
    expect(result.cacheReadTokens).toBe(300 + 0 + 50 + 10);
    expect(result.estimatedCostCents).toBe(150 + 25 + 95 + 30);
  });

  it('aggregates global model breakdown across all entries', () => {
    const result = transformClaudeCodeUsage(MOCK_ENTRIES, 'Org');
    expect(result.modelBreakdown).toHaveLength(2);

    const sonnet = result.modelBreakdown.find(m => m.model === 'claude-sonnet-4-20250514');
    expect(sonnet).toBeDefined();
    expect(sonnet!.inputTokens).toBe(5000 + 3000 + 1000);
    expect(sonnet!.outputTokens).toBe(1000 + 800 + 200);

    const haiku = result.modelBreakdown.find(m => m.model === 'claude-haiku-4-5-20251001');
    expect(haiku).toBeDefined();
    expect(haiku!.inputTokens).toBe(2000);
  });

  it('groups usage by actor', () => {
    const result = transformClaudeCodeUsage(MOCK_ENTRIES, 'Org');
    expect(result.actors).toHaveLength(2);

    const apiActor = result.actors.find(a => a.actorType === 'api_key');
    expect(apiActor).toBeDefined();
    expect(apiActor!.actorName).toBe('my-key');
    // my-key: entry[0] (5000+2000 input) + entry[2] (1000 input)
    expect(apiActor!.inputTokens).toBe(5000 + 2000 + 1000);
    expect(apiActor!.outputTokens).toBe(1000 + 500 + 200);
    expect(apiActor!.estimatedCostCents).toBe(150 + 25 + 30);

    const userActor = result.actors.find(a => a.actorType === 'user');
    expect(userActor).toBeDefined();
    expect(userActor!.actorName).toBe('user@example.com');
    expect(userActor!.inputTokens).toBe(3000);
    expect(userActor!.outputTokens).toBe(800);
  });

  it('includes per-actor model breakdown', () => {
    const result = transformClaudeCodeUsage(MOCK_ENTRIES, 'Org');

    const apiActor = result.actors.find(a => a.actorType === 'api_key')!;
    expect(apiActor.modelBreakdown).toHaveLength(2);
    const apiSonnet = apiActor.modelBreakdown.find(m => m.model === 'claude-sonnet-4-20250514')!;
    expect(apiSonnet.inputTokens).toBe(5000 + 1000); // from entries 0 and 2

    const userActor = result.actors.find(a => a.actorType === 'user')!;
    expect(userActor.modelBreakdown).toHaveLength(1);
    expect(userActor.modelBreakdown[0].model).toBe('claude-sonnet-4-20250514');
  });

  it('computes date range from entries', () => {
    const result = transformClaudeCodeUsage(MOCK_ENTRIES, 'Org');
    expect(result.periodStart).toEqual(new Date('2026-02-15'));
    expect(result.periodEnd).toEqual(new Date('2026-02-16'));
  });

  it('handles empty entries', () => {
    const result = transformClaudeCodeUsage([], 'Empty');
    expect(result.accountName).toBe('Empty');
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.modelBreakdown).toEqual([]);
    expect(result.actors).toEqual([]);
    expect(result.periodStart).toBeInstanceOf(Date);
    expect(result.periodEnd).toBeInstanceOf(Date);
  });

  it('handles single entry', () => {
    const result = transformClaudeCodeUsage([MOCK_ENTRIES[0]], 'Single');
    expect(result.inputTokens).toBe(5000 + 2000);
    expect(result.outputTokens).toBe(1000 + 500);
    expect(result.actors).toHaveLength(1);
    expect(result.actors[0].actorName).toBe('my-key');
    expect(result.periodStart).toEqual(new Date('2026-02-15'));
    expect(result.periodEnd).toEqual(new Date('2026-02-15'));
  });
});
