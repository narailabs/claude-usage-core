// src/types.ts
export interface AccountUsage {
  accountName: string;
  session: { percent: number; resetsAt: Date | null };
  weekly: { percent: number; resetsAt: Date | null };
  opus: { percent: number; resetsAt: Date | null } | null;
  error?: string;
}

export interface Account {
  name: string;
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
  credentials: string; // JSON string of ClaudeCredentials
  savedAt: string;     // ISO timestamp
}

export interface AccountsData {
  accounts: SavedAccount[];
  activeAccountName: string | null;
}
