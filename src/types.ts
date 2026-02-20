// src/types.ts

export interface UsageWindow {
  percent: number;
  resetsAt: Date | null;
}

export interface ExtraUsage {
  isEnabled: boolean;
  monthlyLimit: number | null;
  usedCredits: number | null;
  utilization: number | null;
}

export interface ModelUsageBreakdown {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostCents: number;
}

export interface ActorUsage {
  actorType: 'api_key' | 'user';
  actorName: string; // api_key_name for API keys, email for users
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostCents: number;
  modelBreakdown: ModelUsageBreakdown[];
}

export interface AdminAccountUsage {
  accountType: 'admin';
  accountName: string;
  periodStart: Date;
  periodEnd: Date;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostCents: number;
  modelBreakdown: ModelUsageBreakdown[];
  actors: ActorUsage[];
  error?: string;
}

export interface OAuthAccountUsage {
  accountType: 'oauth';
  accountName: string;
  email?: string;
  session: UsageWindow;
  weekly: UsageWindow;
  opus: UsageWindow | null;
  sonnet: UsageWindow | null;
  oauthApps: UsageWindow | null;
  cowork: UsageWindow | null;
  iguanaNecktie: UsageWindow | null;
  extraUsage: ExtraUsage;
  error?: string;
}

export type AccountUsage = OAuthAccountUsage | AdminAccountUsage;

export type AccountType = 'oauth' | 'admin';

export interface Account {
  name: string;
  email?: string;
  accountType: AccountType;
  isActive: boolean;
  savedAt: Date;
}

export interface ClaudeUsageClientOptions {
  storagePath?: string;
  betaVersion?: string;
  platform?: 'auto' | 'macos' | 'linux' | 'windows';
}

// Internal — not exported from index.ts
export interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  };
}

export interface AdminCredentials {
  adminApiKey: string;
}

export interface SavedAccount {
  name: string;
  email?: string;
  accountType?: AccountType; // undefined treated as 'oauth' for backward compat
  credentials: string; // JSON string of ClaudeCredentials or AdminCredentials
  savedAt: string;     // ISO timestamp
}

export interface AccountsData {
  accounts: SavedAccount[];
  activeAccountName: string | null;
}
