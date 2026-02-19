// src/usage/index.ts
import type { AccountUsage } from '../types.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile';

export class AuthenticationError extends Error {
  constructor(public readonly statusCode: number) {
    super(`Authentication failed (HTTP ${statusCode})`);
    this.name = 'AuthenticationError';
  }
}

export interface RawUsageWindow {
  utilization: number;
  resets_at: string | null;
}

export interface RawExtraUsage {
  is_enabled: boolean;
  monthly_limit: number | null;
  used_credits: number | null;
  utilization: number | null;
}

export interface UsageResponse {
  five_hour: RawUsageWindow;
  seven_day: RawUsageWindow;
  seven_day_opus?: RawUsageWindow | null;
  seven_day_sonnet?: RawUsageWindow | null;
  seven_day_oauth_apps?: RawUsageWindow | null;
  seven_day_cowork?: RawUsageWindow | null;
  iguana_necktie?: RawUsageWindow | null;
  extra_usage?: RawExtraUsage | null;
}

export interface ProfileResponse {
  account: {
    uuid: string;
    full_name: string;
    display_name: string;
    email: string;
    has_claude_max: boolean;
    has_claude_pro: boolean;
    created_at: string;
  };
  organization: {
    uuid: string;
    name: string;
    organization_type: string;
    billing_type: string;
    rate_limit_tier: string;
    has_extra_usage_enabled: boolean;
    subscription_status: string;
    subscription_created_at: string;
  };
}

function makeHeaders(token: string, betaVersion: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'anthropic-beta': betaVersion,
  };
}

export async function fetchProfile(
  token: string,
  betaVersion = 'oauth-2025-04-20'
): Promise<ProfileResponse> {
  const response = await fetch(PROFILE_URL, {
    headers: makeHeaders(token, betaVersion),
  });
  if (!response.ok) {
    if (response.status === 401) throw new AuthenticationError(401);
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<ProfileResponse>;
}

export async function fetchUsage(
  token: string,
  betaVersion = 'oauth-2025-04-20'
): Promise<UsageResponse> {
  const response = await fetch(USAGE_URL, {
    headers: makeHeaders(token, betaVersion),
  });
  if (!response.ok) {
    if (response.status === 401) throw new AuthenticationError(401);
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<UsageResponse>;
}

function transformWindow(w: RawUsageWindow | null | undefined) {
  if (!w) return null;
  return { percent: w.utilization, resetsAt: w.resets_at ? new Date(w.resets_at) : null };
}

export function transformUsageData(data: UsageResponse): Omit<AccountUsage, 'accountName' | 'email' | 'error'> {
  return {
    session: { percent: data.five_hour.utilization, resetsAt: data.five_hour.resets_at ? new Date(data.five_hour.resets_at) : null },
    weekly: { percent: data.seven_day.utilization, resetsAt: data.seven_day.resets_at ? new Date(data.seven_day.resets_at) : null },
    opus: transformWindow(data.seven_day_opus),
    sonnet: transformWindow(data.seven_day_sonnet),
    oauthApps: transformWindow(data.seven_day_oauth_apps),
    cowork: transformWindow(data.seven_day_cowork),
    iguanaNecktie: transformWindow(data.iguana_necktie),
    extraUsage: {
      isEnabled: data.extra_usage?.is_enabled ?? false,
      monthlyLimit: data.extra_usage?.monthly_limit ?? null,
      usedCredits: data.extra_usage?.used_credits ?? null,
      utilization: data.extra_usage?.utilization ?? null,
    },
  };
}
