// src/client.ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from './storage/index.js';
import { createCredentialReader, type Platform } from './credentials/index.js';
import { validateToken, refreshToken } from './tokens/index.js';
import { fetchProfile, fetchUsage, transformUsageData, AuthenticationError } from './usage/index.js';
import { AccountNotFoundError } from './errors.js';
import type { Account, AccountUsage, ClaudeUsageClientOptions, ClaudeCredentials } from './types.js';

const DEFAULT_STORAGE = join(homedir(), '.claude-usage', 'accounts.enc');

const EMPTY_USAGE: Omit<AccountUsage, 'accountName' | 'error'> = {
  session: { percent: 0, resetsAt: null },
  weekly: { percent: 0, resetsAt: null },
  opus: null,
  sonnet: null,
  oauthApps: null,
  cowork: null,
  iguanaNecktie: null,
  extraUsage: { isEnabled: false, monthlyLimit: null, usedCredits: null, utilization: null },
};

export class ClaudeUsageClient {
  private readonly store: AccountStore;
  private readonly betaVersion: string;
  private readonly platform: Platform;

  constructor(options: ClaudeUsageClientOptions = {}) {
    this.store = new AccountStore(options.storagePath ?? DEFAULT_STORAGE);
    this.betaVersion = options.betaVersion ?? 'oauth-2025-04-20';
    this.platform = options.platform ?? 'auto';
  }

  async getSystemToken(): Promise<string | null> {
    const reader = createCredentialReader(this.platform);
    const raw = await reader.read();
    if (!raw) return null;
    try {
      const creds: ClaudeCredentials = JSON.parse(raw);
      return creds.claudeAiOauth?.accessToken ?? null;
    } catch {
      return null;
    }
  }

  async listAccounts(): Promise<Account[]> {
    const data = await this.store.load();
    return data.accounts.map(a => ({
      name: a.name,
      email: a.email,
      isActive: a.name === data.activeAccountName,
      savedAt: new Date(a.savedAt),
    }));
  }

  async saveAccount(name: string, credentials?: string): Promise<void> {
    const creds = credentials ?? await this._readSystemCredentials();
    if (!creds) throw new Error('No credentials available to save');

    // Try to fetch the account email from the profile API
    let email: string | undefined;
    try {
      const parsed: ClaudeCredentials = JSON.parse(creds);
      const token = parsed.claudeAiOauth?.accessToken;
      if (token) {
        const profile = await fetchProfile(token, this.betaVersion);
        email = profile.account.email;
      }
    } catch {
      // Profile fetch is best-effort — save without email
    }

    await this.store.saveAccount(name, creds, email);
  }

  async switchAccount(name: string): Promise<void> {
    const data = await this.store.load();
    const account = data.accounts.find(a => a.name === name);
    if (!account) throw new AccountNotFoundError(name);
    await this.store.setActiveAccount(name);
  }

  async deleteAccount(name: string): Promise<void> {
    const deleted = await this.store.deleteAccount(name);
    if (!deleted) throw new AccountNotFoundError(name);
  }

  async getAllAccountsUsage(): Promise<AccountUsage[]> {
    const data = await this.store.load();
    return Promise.all(
      data.accounts.map(a => this._fetchAccountUsage(a.name, a.email, a.credentials))
    );
  }

  async getAccountUsage(name: string): Promise<AccountUsage> {
    const data = await this.store.load();
    const account = data.accounts.find(a => a.name === name);
    if (!account) throw new AccountNotFoundError(name);
    return this._fetchAccountUsage(account.name, account.email, account.credentials);
  }

  private async _fetchAccountUsage(name: string, email: string | undefined, credentialsJson: string): Promise<AccountUsage> {
    try {
      let creds = credentialsJson;
      const validation = validateToken(creds);

      // Expired — try refresh
      if (validation.isExpired) {
        const refreshed = await refreshToken(creds);
        if (refreshed.success && refreshed.newCredentials) {
          creds = refreshed.newCredentials;
          await this.store.saveAccount(name, creds);
        } else {
          return { accountName: name, email, ...EMPTY_USAGE, error: 'Token expired — refresh failed' };
        }
      }
      // Proactively refresh if < 5 min left
      else if (validation.minutesUntilExpiry !== null && validation.minutesUntilExpiry < 5) {
        const refreshed = await refreshToken(creds);
        if (refreshed.success && refreshed.newCredentials) {
          creds = refreshed.newCredentials;
          await this.store.saveAccount(name, creds);
        }
      }

      const parsed: ClaudeCredentials = JSON.parse(creds);
      const token = parsed.claudeAiOauth?.accessToken;
      if (!token) return { accountName: name, email, ...EMPTY_USAGE, error: 'No access token' };

      const usage = await fetchUsage(token, this.betaVersion);
      return { accountName: name, email, ...transformUsageData(usage) };
    } catch (err) {
      // On 401, attempt refresh once
      if (err instanceof AuthenticationError) {
        try {
          const refreshed = await refreshToken(credentialsJson);
          if (refreshed.success && refreshed.newCredentials) {
            await this.store.saveAccount(name, refreshed.newCredentials);
            const parsed: ClaudeCredentials = JSON.parse(refreshed.newCredentials);
            const token = parsed.claudeAiOauth?.accessToken;
            if (token) {
              const usage = await fetchUsage(token, this.betaVersion);
              return { accountName: name, email, ...transformUsageData(usage) };
            }
          }
        } catch { /* fall through */ }
        return { accountName: name, email, ...EMPTY_USAGE, error: 'Authentication failed' };
      }
      return { accountName: name, email, ...EMPTY_USAGE, error: (err as Error).message };
    }
  }

  private async _readSystemCredentials(): Promise<string | null> {
    const reader = createCredentialReader(this.platform);
    return reader.read();
  }
}
