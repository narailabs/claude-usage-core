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

export interface AccountUsage {
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

export interface Account {
  name: string;
  email?: string;
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

export interface SavedAccount {
  name: string;
  email?: string;
  credentials: string; // JSON string of ClaudeCredentials
  savedAt: string;     // ISO timestamp
}

export interface AccountsData {
  accounts: SavedAccount[];
  activeAccountName: string | null;
}
