// src/admin/index.ts
import { AuthenticationError } from '../errors.js';
import type { AdminAccountUsage, ActorUsage, ModelUsageBreakdown } from '../types.js';

const API_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

// Raw API response types
interface RawModelBreakdown {
  model: string;
  tokens: {
    input: number;
    output: number;
    cache_creation: number;
    cache_read: number;
  };
  estimated_cost: {
    amount: number;
    currency: string;
  };
}

export interface RawClaudeCodeEntry {
  date: string;
  actor: {
    user_actor?: { email: string };
    api_actor?: { api_key_name: string };
  };
  customer_type: string;
  model_breakdown: RawModelBreakdown[];
}

interface RawClaudeCodeResponse {
  data: RawClaudeCodeEntry[];
  has_more: boolean;
  next_page: string | null;
}

/**
 * Fetches the Claude Code usage report from the Admin API.
 * Handles pagination to return all entries.
 * Defaults to usage from the start of the current month.
 */
export async function fetchClaudeCodeUsage(
  adminApiKey: string,
  startingAt?: string,
): Promise<RawClaudeCodeEntry[]> {
  const start = startingAt ?? `${new Date().toISOString().slice(0, 8)}01`;
  const entries: RawClaudeCodeEntry[] = [];
  let page: string | null = null;

  do {
    const params = new URLSearchParams({ starting_at: start, limit: '1000' });
    if (page) params.set('page', page);

    const url = `${API_BASE}/organizations/usage_report/claude_code?${params}`;
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

    const body = await response.json() as RawClaudeCodeResponse;
    entries.push(...body.data);
    page = body.has_more ? body.next_page : null;
  } while (page);

  return entries;
}

function getActorKey(entry: RawClaudeCodeEntry): string {
  if (entry.actor.api_actor) return `api:${entry.actor.api_actor.api_key_name}`;
  if (entry.actor.user_actor) return `user:${entry.actor.user_actor.email}`;
  return 'unknown:unknown';
}

function addToModelMap(map: Map<string, ModelUsageBreakdown>, mb: RawModelBreakdown): void {
  const existing = map.get(mb.model);
  if (existing) {
    existing.inputTokens += mb.tokens.input;
    existing.outputTokens += mb.tokens.output;
    existing.cacheCreationTokens += mb.tokens.cache_creation;
    existing.cacheReadTokens += mb.tokens.cache_read;
    existing.estimatedCostCents += mb.estimated_cost.amount;
  } else {
    map.set(mb.model, {
      model: mb.model,
      inputTokens: mb.tokens.input,
      outputTokens: mb.tokens.output,
      cacheCreationTokens: mb.tokens.cache_creation,
      cacheReadTokens: mb.tokens.cache_read,
      estimatedCostCents: mb.estimated_cost.amount,
    });
  }
}

/**
 * Aggregates raw Claude Code usage entries into an AdminAccountUsage object.
 * Groups by actor (API key or user), with per-model breakdown for each.
 */
export function transformClaudeCodeUsage(
  entries: RawClaudeCodeEntry[],
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

  for (const entry of entries) {
    if (!minDate || entry.date < minDate) minDate = entry.date;
    if (!maxDate || entry.date > maxDate) maxDate = entry.date;

    const actorKey = getActorKey(entry);
    let actor = actorMap.get(actorKey);
    if (!actor) {
      const isApi = !!entry.actor.api_actor;
      actor = {
        actorType: isApi ? 'api_key' : 'user',
        actorName: isApi ? entry.actor.api_actor!.api_key_name : entry.actor.user_actor!.email,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        estimatedCostCents: 0,
        modelMap: new Map(),
      };
      actorMap.set(actorKey, actor);
    }

    for (const mb of entry.model_breakdown) {
      const input = mb.tokens.input;
      const output = mb.tokens.output;
      const cacheCreation = mb.tokens.cache_creation;
      const cacheRead = mb.tokens.cache_read;
      const cost = mb.estimated_cost.amount;

      totalInput += input;
      totalOutput += output;
      totalCacheCreation += cacheCreation;
      totalCacheRead += cacheRead;
      totalCost += cost;

      actor.inputTokens += input;
      actor.outputTokens += output;
      actor.cacheCreationTokens += cacheCreation;
      actor.cacheReadTokens += cacheRead;
      actor.estimatedCostCents += cost;

      addToModelMap(globalModelMap, mb);
      addToModelMap(actor.modelMap, mb);
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
