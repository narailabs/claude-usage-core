// tests/admin/index.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchMessagesUsage, transformMessagesUsage, fetchCostReport, transformCostReport } from '../../src/admin/index.js';
import { AuthenticationError } from '../../src/errors.js';

// Helper to build a raw bucket result matching the messages API shape
function makeResult(overrides: Partial<{
  api_key_id: string | null;
  model: string | null;
  uncached_input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number };
  output_tokens: number;
}> = {}) {
  return {
    api_key_id: 'api_key_id' in overrides ? overrides.api_key_id : 'key-1',
    model: 'model' in overrides ? overrides.model : 'claude-sonnet-4-20250514',
    workspace_id: null,
    uncached_input_tokens: overrides.uncached_input_tokens ?? 5000,
    cache_read_input_tokens: overrides.cache_read_input_tokens ?? 300,
    cache_creation: overrides.cache_creation ?? { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 0 },
    output_tokens: overrides.output_tokens ?? 1000,
    server_tool_use: { web_search_requests: 0 },
  };
}

function makeBucket(date: string, results: ReturnType<typeof makeResult>[]) {
  return { starting_at: date, ending_at: date, results };
}

const MOCK_BUCKETS = [
  makeBucket('2026-02-15', [
    makeResult({ api_key_id: 'key-1', model: 'claude-sonnet-4-20250514', uncached_input_tokens: 5000, cache_read_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 0 }, output_tokens: 1000 }),
    makeResult({ api_key_id: 'key-1', model: 'claude-haiku-4-5-20251001', uncached_input_tokens: 2000, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, output_tokens: 500 }),
  ]),
  makeBucket('2026-02-16', [
    makeResult({ api_key_id: 'key-2', model: 'claude-sonnet-4-20250514', uncached_input_tokens: 3000, cache_read_input_tokens: 50, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 0 }, output_tokens: 800 }),
  ]),
  makeBucket('2026-02-16', [
    makeResult({ api_key_id: 'key-1', model: 'claude-sonnet-4-20250514', uncached_input_tokens: 1000, cache_read_input_tokens: 10, cache_creation: { ephemeral_5m_input_tokens: 50, ephemeral_1h_input_tokens: 0 }, output_tokens: 200 }),
  ]),
];

describe('fetchMessagesUsage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('fetches usage data successfully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: MOCK_BUCKETS, has_more: false, next_page: null }),
    }));
    const buckets = await fetchMessagesUsage('sk-ant-admin-test');
    expect(buckets).toHaveLength(3);
    expect(buckets[0].starting_at).toBe('2026-02-15');
  });

  it('sends correct headers and URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], has_more: false, next_page: null }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await fetchMessagesUsage('sk-ant-admin-test');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/v1/organizations/usage_report/messages');
    expect(url).toContain('group_by[]=api_key_id');
    expect(url).toContain('group_by[]=model');
    expect(init.headers['x-api-key']).toBe('sk-ant-admin-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('passes starting_at parameter', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], has_more: false, next_page: null }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await fetchMessagesUsage('sk-ant-admin-test', '2026-01-01');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('starting_at=2026-01-01T00%3A00%3A00Z');
  });

  it('defaults starting_at to first of current month', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], has_more: false, next_page: null }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await fetchMessagesUsage('sk-ant-admin-test');

    const [url] = mockFetch.mock.calls[0];
    const expectedStart = `${new Date().toISOString().slice(0, 8)}01`;
    expect(url).toContain(`starting_at=${expectedStart}`);
  });

  it('handles pagination', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [MOCK_BUCKETS[0]], has_more: true, next_page: 'page2token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [MOCK_BUCKETS[1]], has_more: false, next_page: null }),
      });
    vi.stubGlobal('fetch', mockFetch);
    const buckets = await fetchMessagesUsage('sk-ant-admin-test');

    expect(buckets).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [secondUrl] = mockFetch.mock.calls[1];
    expect(secondUrl).toContain('page=page2token');
  });

  it('throws AuthenticationError on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' }));
    await expect(fetchMessagesUsage('bad-key')).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('throws error with API message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({ error: { message: 'Insufficient permissions' } }),
    }));
    await expect(fetchMessagesUsage('sk-ant-admin-test')).rejects.toThrow('Insufficient permissions');
  });

  it('throws generic error when no API message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: async () => ({}),
    }));
    await expect(fetchMessagesUsage('sk-ant-admin-test')).rejects.toThrow('Admin API error: 500 Server Error');
  });
});

describe('transformMessagesUsage', () => {
  it('aggregates tokens across all buckets', () => {
    const result = transformMessagesUsage(MOCK_BUCKETS, 'Org');
    expect(result.accountName).toBe('Org');
    // input = uncached + cache_read + cache_creation for each result
    expect(result.inputTokens).toBe(
      (5000 + 300 + 200) + (2000 + 0 + 0) + (3000 + 50 + 100) + (1000 + 10 + 50)
    );
    expect(result.outputTokens).toBe(1000 + 500 + 800 + 200);
    expect(result.cacheCreationTokens).toBe(200 + 0 + 100 + 50);
    expect(result.cacheReadTokens).toBe(300 + 0 + 50 + 10);
  });

  it('computes estimated cost from token counts', () => {
    const result = transformMessagesUsage(MOCK_BUCKETS, 'Org');
    expect(result.estimatedCostCents).toBeGreaterThan(0);
  });

  it('computes per-model cost', () => {
    const result = transformMessagesUsage(MOCK_BUCKETS, 'Org');
    const sonnet = result.modelBreakdown.find(m => m.model === 'claude-sonnet-4-20250514');
    const haiku = result.modelBreakdown.find(m => m.model === 'claude-haiku-4-5-20251001');
    expect(sonnet!.estimatedCostCents).toBeGreaterThan(0);
    expect(haiku!.estimatedCostCents).toBeGreaterThan(0);
    // Sonnet is more expensive per token than Haiku
    expect(sonnet!.estimatedCostCents).toBeGreaterThan(haiku!.estimatedCostCents);
  });

  it('model costs sum to total cost', () => {
    const result = transformMessagesUsage(MOCK_BUCKETS, 'Org');
    const modelCostSum = result.modelBreakdown.reduce((sum, m) => sum + m.estimatedCostCents, 0);
    expect(modelCostSum).toBeCloseTo(result.estimatedCostCents, 10);
  });

  it('actor costs sum to total cost', () => {
    const result = transformMessagesUsage(MOCK_BUCKETS, 'Org');
    const actorCostSum = result.actors.reduce((sum, a) => sum + a.estimatedCostCents, 0);
    expect(actorCostSum).toBeCloseTo(result.estimatedCostCents, 10);
  });

  it('aggregates global model breakdown across all buckets', () => {
    const result = transformMessagesUsage(MOCK_BUCKETS, 'Org');
    expect(result.modelBreakdown).toHaveLength(2);

    const sonnet = result.modelBreakdown.find(m => m.model === 'claude-sonnet-4-20250514');
    expect(sonnet).toBeDefined();
    expect(sonnet!.inputTokens).toBe((5000 + 300 + 200) + (3000 + 50 + 100) + (1000 + 10 + 50));
    expect(sonnet!.outputTokens).toBe(1000 + 800 + 200);

    const haiku = result.modelBreakdown.find(m => m.model === 'claude-haiku-4-5-20251001');
    expect(haiku).toBeDefined();
    expect(haiku!.inputTokens).toBe(2000);
  });

  it('groups usage by actor (api_key_id)', () => {
    const result = transformMessagesUsage(MOCK_BUCKETS, 'Org');
    expect(result.actors).toHaveLength(2);

    const key1 = result.actors.find(a => a.actorName === 'key-1');
    expect(key1).toBeDefined();
    expect(key1!.actorType).toBe('api_key');
    // key-1: bucket[0] results (sonnet + haiku) + bucket[2] result (sonnet)
    expect(key1!.inputTokens).toBe((5000 + 300 + 200) + (2000) + (1000 + 10 + 50));
    expect(key1!.outputTokens).toBe(1000 + 500 + 200);
    expect(key1!.estimatedCostCents).toBeGreaterThan(0);

    const key2 = result.actors.find(a => a.actorName === 'key-2');
    expect(key2).toBeDefined();
    expect(key2!.inputTokens).toBe(3000 + 50 + 100);
    expect(key2!.outputTokens).toBe(800);
  });

  it('includes per-actor model breakdown', () => {
    const result = transformMessagesUsage(MOCK_BUCKETS, 'Org');

    const key1 = result.actors.find(a => a.actorName === 'key-1')!;
    expect(key1.modelBreakdown).toHaveLength(2);
    const key1Sonnet = key1.modelBreakdown.find(m => m.model === 'claude-sonnet-4-20250514')!;
    expect(key1Sonnet.inputTokens).toBe((5000 + 300 + 200) + (1000 + 10 + 50));

    const key2 = result.actors.find(a => a.actorName === 'key-2')!;
    expect(key2.modelBreakdown).toHaveLength(1);
    expect(key2.modelBreakdown[0].model).toBe('claude-sonnet-4-20250514');
  });

  it('computes date range from buckets', () => {
    const result = transformMessagesUsage(MOCK_BUCKETS, 'Org');
    expect(result.periodStart).toEqual(new Date('2026-02-15'));
    expect(result.periodEnd).toEqual(new Date('2026-02-16'));
  });

  it('handles empty buckets', () => {
    const result = transformMessagesUsage([], 'Empty');
    expect(result.accountName).toBe('Empty');
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.estimatedCostCents).toBe(0);
    expect(result.modelBreakdown).toEqual([]);
    expect(result.actors).toEqual([]);
    expect(result.periodStart).toBeInstanceOf(Date);
    expect(result.periodEnd).toBeInstanceOf(Date);
  });

  it('defaults null api_key_id to console', () => {
    const buckets = [makeBucket('2026-02-15', [
      makeResult({ api_key_id: null }),
    ])];
    const result = transformMessagesUsage(buckets, 'Org');
    expect(result.actors).toHaveLength(1);
    expect(result.actors[0].actorName).toBe('console');
  });

  it('defaults null model to unknown', () => {
    const buckets = [makeBucket('2026-02-15', [
      makeResult({ model: null }),
    ])];
    const result = transformMessagesUsage(buckets, 'Org');
    expect(result.modelBreakdown).toHaveLength(1);
    expect(result.modelBreakdown[0].model).toBe('unknown');
    // Unknown model should have 0 cost
    expect(result.modelBreakdown[0].estimatedCostCents).toBe(0);
  });
});

// Helper to build a raw cost bucket result
function makeCostResult(overrides: Partial<{
  amount: string;
  currency: string;
  cost_type: string | null;
  description: string | null;
  model: string | null;
  token_type: string | null;
  service_tier: string | null;
  workspace_id: string | null;
  context_window: string | null;
  inference_geo: string | null;
  speed: string | null;
}> = {}) {
  return {
    amount: overrides.amount ?? '100.00',
    currency: overrides.currency ?? 'USD',
    cost_type: 'cost_type' in overrides ? overrides.cost_type : 'tokens',
    description: 'description' in overrides ? overrides.description : null,
    model: 'model' in overrides ? overrides.model : 'claude-sonnet-4-20250514',
    token_type: 'token_type' in overrides ? overrides.token_type : null,
    service_tier: 'service_tier' in overrides ? overrides.service_tier : null,
    workspace_id: 'workspace_id' in overrides ? overrides.workspace_id : null,
    context_window: 'context_window' in overrides ? overrides.context_window : null,
    inference_geo: 'inference_geo' in overrides ? overrides.inference_geo : null,
    speed: 'speed' in overrides ? overrides.speed : null,
  };
}

function makeCostBucket(date: string, results: ReturnType<typeof makeCostResult>[]) {
  return { starting_at: date, ending_at: date, results };
}

const MOCK_COST_BUCKETS = [
  makeCostBucket('2026-02-15', [
    makeCostResult({ amount: '123.45', model: 'claude-sonnet-4-20250514' }),
    makeCostResult({ amount: '50.00', model: 'claude-haiku-4-5-20251001' }),
  ]),
  makeCostBucket('2026-02-16', [
    makeCostResult({ amount: '200.00', model: 'claude-sonnet-4-20250514' }),
  ]),
];

describe('fetchCostReport', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('fetches cost report data successfully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: MOCK_COST_BUCKETS, has_more: false, next_page: null }),
    }));
    const buckets = await fetchCostReport('sk-ant-admin-test');
    expect(buckets).toHaveLength(2);
    expect(buckets[0].starting_at).toBe('2026-02-15');
    expect(buckets[0].results[0].amount).toBe('123.45');
  });

  it('sends correct headers and URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], has_more: false, next_page: null }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await fetchCostReport('sk-ant-admin-test');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/v1/organizations/cost_report');
    expect(url).toContain('bucket_width=1d');
    expect(url).toContain('limit=31');
    expect(init.headers['x-api-key']).toBe('sk-ant-admin-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('passes starting_at parameter', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], has_more: false, next_page: null }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await fetchCostReport('sk-ant-admin-test', '2026-01-01');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('starting_at=2026-01-01T00%3A00%3A00Z');
  });

  it('defaults starting_at to first of current month', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], has_more: false, next_page: null }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await fetchCostReport('sk-ant-admin-test');

    const [url] = mockFetch.mock.calls[0];
    const expectedStart = `${new Date().toISOString().slice(0, 8)}01`;
    expect(url).toContain(`starting_at=${expectedStart}`);
  });

  it('includes ending_at set to tomorrow', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], has_more: false, next_page: null }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await fetchCostReport('sk-ant-admin-test');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('ending_at=');
  });

  it('handles pagination', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [MOCK_COST_BUCKETS[0]], has_more: true, next_page: 'page2token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [MOCK_COST_BUCKETS[1]], has_more: false, next_page: null }),
      });
    vi.stubGlobal('fetch', mockFetch);
    const buckets = await fetchCostReport('sk-ant-admin-test');

    expect(buckets).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [secondUrl] = mockFetch.mock.calls[1];
    expect(secondUrl).toContain('page=page2token');
  });

  it('throws AuthenticationError on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' }));
    await expect(fetchCostReport('bad-key')).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('throws error with API message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({ error: { message: 'Insufficient permissions' } }),
    }));
    await expect(fetchCostReport('sk-ant-admin-test')).rejects.toThrow('Insufficient permissions');
  });

  it('throws generic error when no API message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: async () => ({}),
    }));
    await expect(fetchCostReport('sk-ant-admin-test')).rejects.toThrow('Admin API error: 500 Server Error');
  });
});

describe('transformCostReport', () => {
  it('sums amounts across all buckets and results', () => {
    // MOCK_COST_BUCKETS: 123.45 + 50.00 + 200.00 = 373.45 cents
    const total = transformCostReport(MOCK_COST_BUCKETS);
    expect(total).toBeCloseTo(373.45, 5);
  });

  it('returns 0 for empty buckets', () => {
    const total = transformCostReport([]);
    expect(total).toBe(0);
  });

  it('returns 0 for buckets with no results', () => {
    const buckets = [makeCostBucket('2026-02-15', [])];
    const total = transformCostReport(buckets);
    expect(total).toBe(0);
  });

  it('handles a single result', () => {
    const buckets = [makeCostBucket('2026-02-15', [makeCostResult({ amount: '42.50' })])];
    const total = transformCostReport(buckets);
    expect(total).toBeCloseTo(42.5, 5);
  });

  it('handles fractional cent amounts correctly', () => {
    const buckets = [
      makeCostBucket('2026-02-15', [
        makeCostResult({ amount: '1.1' }),
        makeCostResult({ amount: '2.2' }),
        makeCostResult({ amount: '3.3' }),
      ]),
    ];
    const total = transformCostReport(buckets);
    expect(total).toBeCloseTo(6.6, 5);
  });

  it('handles null cost_type results (non-token charges)', () => {
    const buckets = [makeCostBucket('2026-02-15', [
      makeCostResult({ amount: '10.00', cost_type: null }),
      makeCostResult({ amount: '5.00', cost_type: 'web_search' }),
    ])];
    const total = transformCostReport(buckets);
    expect(total).toBeCloseTo(15.0, 5);
  });
});
