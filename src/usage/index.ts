// src/usage/index.ts
import type { AccountUsage } from '../types.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export class AuthenticationError extends Error {
  constructor(public readonly statusCode: number) {
    super(`Authentication failed (HTTP ${statusCode})`);
    this.name = 'AuthenticationError';
  }
}

export interface UsageWindow {
  utilization: number;
  resets_at: string | null;
}

export interface UsageResponse {
  five_hour: UsageWindow;
  seven_day: UsageWindow;
  seven_day_opus?: UsageWindow | null;
}

export async function fetchUsage(
  token: string,
  betaVersion = 'oauth-2025-04-20'
): Promise<UsageResponse> {
  const response = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'anthropic-beta': betaVersion,
      'User-Agent': 'claude-usage-core/0.1.0',
    },
  });
  if (!response.ok) {
    if (response.status === 401) throw new AuthenticationError(401);
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<UsageResponse>;
}

export function transformUsageData(data: UsageResponse): Omit<AccountUsage, 'accountName' | 'error'> {
  return {
    session: {
      percent: data.five_hour.utilization,
      resetsAt: data.five_hour.resets_at ? new Date(data.five_hour.resets_at) : null,
    },
    weekly: {
      percent: data.seven_day.utilization,
      resetsAt: data.seven_day.resets_at ? new Date(data.seven_day.resets_at) : null,
    },
    opus: data.seven_day_opus
      ? { percent: data.seven_day_opus.utilization, resetsAt: data.seven_day_opus.resets_at ? new Date(data.seven_day_opus.resets_at) : null }
      : null,
  };
}
