// src/admin/index.ts
import { AuthenticationError } from '../errors.js';
import type { AdminAccountUsage, ActorUsage, ModelUsageBreakdown } from '../types.js';
import { estimateCostCents } from './pricing.js';

const API_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

// Raw API response types for /cost_report
interface RawCostBucketResult {
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
}

interface RawCostBucket {
  starting_at: string;
  ending_at: string;
  results: RawCostBucketResult[];
}

interface RawCostReport {
  data: RawCostBucket[];
  has_more: boolean;
  next_page: string | null;
}

// Raw API response types for /usage_report/messages
interface RawCacheCreation {
  ephemeral_5m_input_tokens: number;
  ephemeral_1h_input_tokens: number;
}

interface RawBucketResult {
  api_key_id: string | null;
  model: string | null;
  workspace_id: string | null;
  uncached_input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation: RawCacheCreation;
  output_tokens: number;
  server_tool_use: { web_search_requests: number };
}

interface RawBucket {
  starting_at: string;
  ending_at: string;
  results: RawBucketResult[];
}

interface RawMessagesUsageReport {
  data: RawBucket[];
  has_more: boolean;
  next_page: string | null;
}

/**
 * Fetches the messages usage report from the Admin API.
 * Uses /v1/organizations/usage_report/messages with daily buckets grouped by API key and model.
 * @param startingAt YYYY-MM-DD date string (converted to RFC 3339 internally)
 */
export async function fetchMessagesUsage(
  adminApiKey: string,
  startingAt?: string,
): Promise<RawBucket[]> {
  const startDate = startingAt ?? `${new Date().toISOString().slice(0, 8)}01`;
  const start = `${startDate}T00:00:00Z`;

  // End at tomorrow to include all of today's data
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const end = `${tomorrow.toISOString().slice(0, 10)}T00:00:00Z`;

  const buckets: RawBucket[] = [];
  let page: string | null = null;

  do {
    const params = new URLSearchParams({
      starting_at: start,
      ending_at: end,
      bucket_width: '1d',
      limit: '31',
    });
    if (page) params.set('page', page);

    // Append group_by[] manually — URLSearchParams encodes [] to %5B%5D which the API may reject
    const url = `${API_BASE}/organizations/usage_report/messages?${params}&group_by[]=api_key_id&group_by[]=model`;
    const response = await fetch(url, {
      headers: {
        'x-api-key': adminApiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
    });

    if (!response.ok) {
      if (response.status === 401) throw new AuthenticationError(401);
      let errorMessage = '';
      try {
        const body = await response.json() as { error?: { message?: string } };
        errorMessage = body.error?.message ?? '';
      } catch { /* ignore parse errors */ }
      throw new Error(errorMessage || `Admin API error: ${response.status} ${response.statusText}`);
    }

    const body = await response.json() as RawMessagesUsageReport;
    buckets.push(...body.data);
    page = body.has_more ? body.next_page : null;
  } while (page);

  return buckets;
}

function addToModelMap(map: Map<string, ModelUsageBreakdown>, model: string, input: number, output: number, cacheCreation: number, cacheRead: number, cost: number): void {
  const existing = map.get(model);
  if (existing) {
    existing.inputTokens += input;
    existing.outputTokens += output;
    existing.cacheCreationTokens += cacheCreation;
    existing.cacheReadTokens += cacheRead;
    existing.estimatedCostCents += cost;
  } else {
    map.set(model, {
      model,
      inputTokens: input,
      outputTokens: output,
      cacheCreationTokens: cacheCreation,
      cacheReadTokens: cacheRead,
      estimatedCostCents: cost,
    });
  }
}

/**
 * Aggregates raw messages usage buckets into an AdminAccountUsage object.
 * Groups by API key (actor), with per-model breakdown for each.
 */
export function transformMessagesUsage(
  buckets: RawBucket[],
  accountName: string,
): Omit<AdminAccountUsage, 'accountType' | 'error'> {
  const globalModelMap = new Map<string, ModelUsageBreakdown>();
  const actorMap = new Map<string, {
    actorType: 'api_key' | 'user';
    actorName: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    estimatedCostCents: number;
    modelMap: Map<string, ModelUsageBreakdown>;
  }>();

  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheCreation = 0;
  let totalCacheRead = 0;
  let totalCost = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const bucket of buckets) {
    const bucketDate = bucket.starting_at;
    if (!minDate || bucketDate < minDate) minDate = bucketDate;
    if (!maxDate || bucketDate > maxDate) maxDate = bucketDate;

    for (const result of bucket.results) {
      const input = result.uncached_input_tokens + result.cache_read_input_tokens
        + result.cache_creation.ephemeral_5m_input_tokens + result.cache_creation.ephemeral_1h_input_tokens;
      const output = result.output_tokens;
      const cacheCreation = result.cache_creation.ephemeral_5m_input_tokens + result.cache_creation.ephemeral_1h_input_tokens;
      const cacheRead = result.cache_read_input_tokens;

      const model = result.model ?? 'unknown';
      const uncachedInput = result.uncached_input_tokens;
      const cache5m = result.cache_creation.ephemeral_5m_input_tokens;
      const cache1h = result.cache_creation.ephemeral_1h_input_tokens;
      const cost = estimateCostCents(model, uncachedInput, cacheRead, cache5m, cache1h, output);

      totalInput += input;
      totalOutput += output;
      totalCacheCreation += cacheCreation;
      totalCacheRead += cacheRead;
      totalCost += cost;

      // Actor aggregation (by API key ID)
      const actorKey = result.api_key_id ?? 'console';
      let actor = actorMap.get(actorKey);
      if (!actor) {
        actor = {
          actorType: 'api_key',
          actorName: actorKey,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          estimatedCostCents: 0,
          modelMap: new Map(),
        };
        actorMap.set(actorKey, actor);
      }
      actor.inputTokens += input;
      actor.outputTokens += output;
      actor.cacheCreationTokens += cacheCreation;
      actor.cacheReadTokens += cacheRead;
      actor.estimatedCostCents += cost;

      addToModelMap(globalModelMap, model, input, output, cacheCreation, cacheRead, cost);
      addToModelMap(actor.modelMap, model, input, output, cacheCreation, cacheRead, cost);
    }
  }

  const actors: ActorUsage[] = Array.from(actorMap.values()).map(a => ({
    actorType: a.actorType,
    actorName: a.actorName,
    inputTokens: a.inputTokens,
    outputTokens: a.outputTokens,
    cacheCreationTokens: a.cacheCreationTokens,
    cacheReadTokens: a.cacheReadTokens,
    estimatedCostCents: a.estimatedCostCents,
    modelBreakdown: Array.from(a.modelMap.values()),
  }));

  return {
    accountName,
    periodStart: minDate ? new Date(minDate) : new Date(),
    periodEnd: maxDate ? new Date(maxDate) : new Date(),
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cacheCreationTokens: totalCacheCreation,
    cacheReadTokens: totalCacheRead,
    estimatedCostCents: totalCost,
    modelBreakdown: Array.from(globalModelMap.values()),
    actors,
  };
}

/**
 * Fetches the cost report from the Admin API.
 * Uses /v1/organizations/cost_report with daily buckets.
 * Returns actual billed costs rather than token-based estimates.
 * @param startingAt YYYY-MM-DD date string (converted to RFC 3339 internally)
 */
export async function fetchCostReport(
  adminApiKey: string,
  startingAt?: string,
): Promise<RawCostBucket[]> {
  const startDate = startingAt ?? `${new Date().toISOString().slice(0, 8)}01`;
  const start = `${startDate}T00:00:00Z`;

  // End at tomorrow to include all of today's data
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const end = `${tomorrow.toISOString().slice(0, 10)}T00:00:00Z`;

  const buckets: RawCostBucket[] = [];
  let page: string | null = null;

  do {
    const params = new URLSearchParams({
      starting_at: start,
      ending_at: end,
      bucket_width: '1d',
      limit: '31',
    });
    if (page) params.set('page', page);

    const url = `${API_BASE}/organizations/cost_report?${params}`;
    const response = await fetch(url, {
      headers: {
        'x-api-key': adminApiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
    });

    if (!response.ok) {
      if (response.status === 401) throw new AuthenticationError(401);
      let errorMessage = '';
      try {
        const body = await response.json() as { error?: { message?: string } };
        errorMessage = body.error?.message ?? '';
      } catch { /* ignore parse errors */ }
      throw new Error(errorMessage || `Admin API error: ${response.status} ${response.statusText}`);
    }

    const body = await response.json() as RawCostReport;
    buckets.push(...body.data);
    page = body.has_more ? body.next_page : null;
  } while (page);

  return buckets;
}

/**
 * Aggregates raw cost report buckets into a total cost in cents.
 * The `amount` field is a decimal string in cents (e.g. "123.45" = 123.45 cents = $1.2345).
 */
export function transformCostReport(buckets: RawCostBucket[]): number {
  let totalCents = 0;
  for (const bucket of buckets) {
    for (const result of bucket.results) {
      totalCents += parseFloat(result.amount);
    }
  }
  return totalCents;
}
