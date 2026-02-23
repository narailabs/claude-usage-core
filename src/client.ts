// src/client.ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from './storage/index.js';
import { createCredentialReader, type Platform } from './credentials/index.js';
import { validateToken, refreshToken } from './tokens/index.js';
import { fetchProfile, fetchUsage, transformUsageData } from './usage/index.js';
import { fetchMessagesUsage, transformMessagesUsage, fetchCostReport, transformCostReport } from './admin/index.js';
import { authorize, type AuthorizeOptions } from './auth/index.js';
import { AccountNotFoundError, AuthenticationError } from './errors.js';
import type { Account, AccountUsage, OAuthAccountUsage, AdminAccountUsage, ClaudeUsageClientOptions, UsageOptions, ClaudeCredentials, AdminCredentials } from './types.js';

const DEFAULT_STORAGE = join(homedir(), '.claude-usage', 'accounts.enc');

const EMPTY_OAUTH_USAGE: Omit<OAuthAccountUsage, 'accountName' | 'error'> = {
  accountType: 'oauth',
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
      accountType: a.accountType ?? 'oauth',
      isActive: a.name === data.activeAccountName,
      savedAt: new Date(a.savedAt),
    }));
  }

  async authenticate(name: string, options?: AuthorizeOptions): Promise<void> {
    const credentials = await authorize(options);
    await this.saveAccount(name, credentials);
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

    await this.store.saveAccount(name, creds, email, 'oauth');
  }

  async saveAdminAccount(name: string, adminApiKey: string): Promise<void> {
    if (!adminApiKey.startsWith('sk-ant-admin')) {
      throw new Error('Invalid admin API key format — must start with "sk-ant-admin"');
    }
    // Validate the key works by fetching usage (will throw on 401)
    await fetchMessagesUsage(adminApiKey);
    const creds: AdminCredentials = { adminApiKey };
    await this.store.saveAccount(name, JSON.stringify(creds), undefined, 'admin');
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

  async renameAccount(oldName: string, newName: string): Promise<void> {
    const renamed = await this.store.renameAccount(oldName, newName);
    if (!renamed) throw new AccountNotFoundError(oldName);
  }

  async refreshToken(name: string): Promise<void> {
    // Verify account exists and is OAuth
    const data = await this.store.load();
    const account = data.accounts.find(a => a.name === name);
    if (!account) throw new AccountNotFoundError(name);
    if (account.accountType === 'admin') {
      throw new Error('Cannot refresh token for an admin account');
    }

    // Re-authenticate via claude setup-token (always yields long-lived ~1yr token)
    await this.authenticate(name);
  }

  async getAllAccountsUsage(options?: UsageOptions): Promise<AccountUsage[]> {
    const data = await this.store.load();
    return Promise.all(
      data.accounts.map(a => this._fetchAccountUsage(a, options))
    );
  }

  async getAccountUsage(name: string, options?: UsageOptions): Promise<AccountUsage> {
    const data = await this.store.load();
    const account = data.accounts.find(a => a.name === name);
    if (!account) throw new AccountNotFoundError(name);
    return this._fetchAccountUsage(account, options);
  }

  private async _fetchAccountUsage(account: { name: string; email?: string; credentials: string; accountType?: string }, options?: UsageOptions): Promise<AccountUsage> {
    const accountType = account.accountType ?? 'oauth';

    if (accountType === 'admin') {
      return this._fetchAdminAccountUsage(account.name, account.credentials, options?.startingAt);
    }
    return this._fetchOAuthAccountUsage(account.name, account.email, account.credentials);
  }

  private async _fetchAdminAccountUsage(name: string, credentialsJson: string, startingAt?: string): Promise<AdminAccountUsage> {
    try {
      const creds: AdminCredentials = JSON.parse(credentialsJson);
      const [buckets, costBuckets] = await Promise.all([
        fetchMessagesUsage(creds.adminApiKey, startingAt),
        fetchCostReport(creds.adminApiKey, startingAt).catch(() => null),
      ]);
      const usage = transformMessagesUsage(buckets, name);
      // Use requested date range for period display instead of data-derived dates
      const requestedStart = startingAt ?? `${new Date().toISOString().slice(0, 8)}01`;
      usage.periodStart = new Date(`${requestedStart}T00:00:00Z`);
      usage.periodEnd = new Date();
      const actualCostCents = costBuckets !== null ? transformCostReport(costBuckets) : undefined;
      return { accountType: 'admin', ...usage, ...(actualCostCents !== undefined ? { actualCostCents } : {}) };
    } catch (err) {
      return {
        accountType: 'admin',
        accountName: name,
        periodStart: new Date(),
        periodEnd: new Date(),
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        estimatedCostCents: 0,
        modelBreakdown: [],
        actors: [],
        error: (err as Error).message,
      };
    }
  }

  private async _fetchOAuthAccountUsage(name: string, email: string | undefined, credentialsJson: string): Promise<OAuthAccountUsage> {
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
          return { ...EMPTY_OAUTH_USAGE, accountName: name, email, error: 'Token expired — refresh failed' };
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
      if (!token) return { ...EMPTY_OAUTH_USAGE, accountName: name, email, error: 'No access token' };

      const usage = await fetchUsage(token, this.betaVersion);
      return { accountType: 'oauth', ...transformUsageData(usage), accountName: name, email };
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
              return { accountType: 'oauth', ...transformUsageData(usage), accountName: name, email };
            }
          }
        } catch { /* fall through */ }
        return { ...EMPTY_OAUTH_USAGE, accountName: name, email, error: 'Authentication failed' };
      }
      return { ...EMPTY_OAUTH_USAGE, accountName: name, email, error: (err as Error).message };
    }
  }

  private async _readSystemCredentials(): Promise<string | null> {
    const reader = createCredentialReader(this.platform);
    return reader.read();
  }
}
