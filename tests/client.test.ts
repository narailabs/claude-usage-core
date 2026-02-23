// tests/client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeUsageClient } from '../src/client.js';
import { AccountNotFoundError } from '../src/errors.js';
import { createCredentialReader } from '../src/credentials/index.js';
import { authorize } from '../src/auth/index.js';

// Mock credential reader
vi.mock('../src/credentials/index.js', () => ({
  createCredentialReader: vi.fn(() => ({ read: vi.fn().mockResolvedValue(null) })),
}));

// Mock auth module (provide constants for tokens/index.ts)
vi.mock('../src/auth/index.js', () => ({
  authorize: vi.fn(),
  OAUTH_CLIENT_ID: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  OAUTH_TOKEN_URL: 'https://platform.claude.com/v1/oauth/token',
}));

// Mock admin module
vi.mock('../src/admin/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/admin/index.js')>();
  return {
    ...actual,
    fetchMessagesUsage: vi.fn(),
    fetchCostReport: vi.fn(),
  };
});

import { fetchMessagesUsage, fetchCostReport } from '../src/admin/index.js';
import { AuthenticationError } from '../src/errors.js';

const MOCK_USAGE = {
  five_hour: { utilization: 0.5, resets_at: null },
  seven_day: { utilization: 0.3, resets_at: null },
  seven_day_opus: null,
};

const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const VALID_CREDS = JSON.stringify({
  claudeAiOauth: { accessToken: 'tok', refreshToken: 'rt', expiresAt: FUTURE }
});
const PAST = new Date(Date.now() - 60_000).toISOString();
const EXPIRED_CREDS = JSON.stringify({
  claudeAiOauth: { accessToken: 'tok', refreshToken: 'rt', expiresAt: PAST }
});
const NEAR_EXPIRY = new Date(Date.now() + 2 * 60_000).toISOString();
const NEAR_EXPIRED_CREDS = JSON.stringify({
  claudeAiOauth: { accessToken: 'tok', refreshToken: 'rt', expiresAt: NEAR_EXPIRY }
});
const NO_TOKEN_CREDS = JSON.stringify({
  claudeAiOauth: { expiresAt: FUTURE }
});

const ADMIN_KEY = 'sk-ant-admin-test-key-123';

const MOCK_ADMIN_ENTRIES = [
  {
    starting_at: '2026-02-15T00:00:00Z',
    ending_at: '2026-02-16T00:00:00Z',
    results: [
      {
        api_key_id: 'my-key',
        model: 'claude-sonnet-4-20250514',
        workspace_id: null,
        uncached_input_tokens: 5000,
        cache_read_input_tokens: 0,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
        output_tokens: 1000,
        server_tool_use: { web_search_requests: 0 },
      },
    ],
  },
];

const MOCK_PROFILE = {
  account: { uuid: 'u1', full_name: 'Test', display_name: 'T', email: 'test@example.com', has_claude_max: false, has_claude_pro: true, created_at: '2025-01-01' },
  organization: { uuid: 'o1', name: 'Org', organization_type: 'personal', billing_type: 'stripe', rate_limit_tier: 'tier1', has_extra_usage_enabled: false, subscription_status: 'active', subscription_created_at: '2025-01-01' },
};

const MOCK_REFRESH_RESPONSE = {
  access_token: 'new-tok',
  refresh_token: 'new-rt',
  expires_in: 3600,
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'claude-usage-client-test-'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => MOCK_USAGE,
  }));
  vi.mocked(fetchMessagesUsage).mockResolvedValue([]);
  vi.mocked(fetchCostReport).mockResolvedValue([]);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeClient() {
  return new ClaudeUsageClient({ storagePath: join(tmpDir, 'accounts.enc') });
}

describe('ClaudeUsageClient', () => {
  describe('account management', () => {
    it('starts with no accounts', async () => {
      const accounts = await makeClient().listAccounts();
      expect(accounts).toEqual([]);
    });

    it('saves and lists an account', async () => {
      const client = makeClient();
      await client.saveAccount('Work', VALID_CREDS);
      const accounts = await client.listAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe('Work');
      expect(accounts[0].isActive).toBe(false);
    });

    it('switchAccount sets active', async () => {
      const client = makeClient();
      await client.saveAccount('Work', VALID_CREDS);
      await client.switchAccount('Work');
      const accounts = await client.listAccounts();
      expect(accounts[0].isActive).toBe(true);
    });

    it('switchAccount throws for unknown account', async () => {
      await expect(makeClient().switchAccount('NoSuch')).rejects.toBeInstanceOf(AccountNotFoundError);
    });

    it('deleteAccount removes it', async () => {
      const client = makeClient();
      await client.saveAccount('Work', VALID_CREDS);
      await client.deleteAccount('Work');
      expect(await client.listAccounts()).toEqual([]);
    });

    it('deleteAccount throws for unknown account', async () => {
      await expect(makeClient().deleteAccount('NoSuch')).rejects.toBeInstanceOf(AccountNotFoundError);
    });

    it('renameAccount renames an existing account', async () => {
      const client = makeClient();
      await client.saveAccount('OldName', VALID_CREDS);
      await client.renameAccount('OldName', 'NewName');
      const accounts = await client.listAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe('NewName');
    });

    it('renameAccount throws for unknown account', async () => {
      await expect(makeClient().renameAccount('NoSuch', 'New')).rejects.toBeInstanceOf(AccountNotFoundError);
    });
  });

  describe('getAllAccountsUsage', () => {
    it('fetches usage for all accounts in parallel', async () => {
      const client = makeClient();
      await client.saveAccount('Work', VALID_CREDS);
      await client.saveAccount('Personal', VALID_CREDS);
      const results = await client.getAllAccountsUsage();
      expect(results).toHaveLength(2);
      expect(results.map(r => r.accountName).sort()).toEqual(['Personal', 'Work']);
      expect(results[0].error).toBeUndefined();
    });

    it('sets error on per-account fetch failure', async () => {
      const client = makeClient();
      await client.saveAccount('Bad', VALID_CREDS);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Err' }));
      const results = await client.getAllAccountsUsage();
      expect(results[0].error).toBeDefined();
    });

    it('returns empty array when no accounts saved', async () => {
      const results = await makeClient().getAllAccountsUsage();
      expect(results).toEqual([]);
    });
  });

  describe('getAccountUsage', () => {
    it('fetches usage for named account', async () => {
      const client = makeClient();
      await client.saveAccount('Work', VALID_CREDS);
      const result = await client.getAccountUsage('Work');
      expect(result.accountName).toBe('Work');
      if (result.accountType === 'oauth') {
        expect(result.session.percent).toBe(0.5);
      }
    });

    it('throws AccountNotFoundError for unknown account', async () => {
      await expect(makeClient().getAccountUsage('NoSuch')).rejects.toBeInstanceOf(AccountNotFoundError);
    });
  });

  describe('getSystemToken', () => {
    it('returns access token from system credentials', async () => {
      vi.mocked(createCredentialReader).mockReturnValue({
        read: vi.fn().mockResolvedValue(VALID_CREDS),
      });
      const token = await makeClient().getSystemToken();
      expect(token).toBe('tok');
    });

    it('returns null when no credentials available', async () => {
      vi.mocked(createCredentialReader).mockReturnValue({
        read: vi.fn().mockResolvedValue(null),
      });
      const token = await makeClient().getSystemToken();
      expect(token).toBeNull();
    });

    it('returns null on invalid JSON credentials', async () => {
      vi.mocked(createCredentialReader).mockReturnValue({
        read: vi.fn().mockResolvedValue('not-valid-json'),
      });
      const token = await makeClient().getSystemToken();
      expect(token).toBeNull();
    });

    it('returns null when credentials have no access token', async () => {
      vi.mocked(createCredentialReader).mockReturnValue({
        read: vi.fn().mockResolvedValue(JSON.stringify({ claudeAiOauth: {} })),
      });
      const token = await makeClient().getSystemToken();
      expect(token).toBeNull();
    });
  });

  describe('authenticate', () => {
    it('calls authorize and saves the account', async () => {
      vi.mocked(authorize).mockResolvedValue(VALID_CREDS);
      const client = makeClient();
      await client.authenticate('Work');
      const accounts = await client.listAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe('Work');
    });
  });

  describe('saveAccount', () => {
    it('reads system credentials when none provided', async () => {
      vi.mocked(createCredentialReader).mockReturnValue({
        read: vi.fn().mockResolvedValue(VALID_CREDS),
      });
      const client = makeClient();
      await client.saveAccount('Work');
      const accounts = await client.listAccounts();
      expect(accounts).toHaveLength(1);
    });

    it('throws when no credentials available and none provided', async () => {
      vi.mocked(createCredentialReader).mockReturnValue({
        read: vi.fn().mockResolvedValue(null),
      });
      await expect(makeClient().saveAccount('Work')).rejects.toThrow('No credentials available');
    });

    it('fetches profile and saves email on success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MOCK_PROFILE,
      }));
      const client = makeClient();
      await client.saveAccount('Work', VALID_CREDS);
      const accounts = await client.listAccounts();
      expect(accounts[0].email).toBe('test@example.com');
    });

    it('saves without email when profile fetch fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Err' }));
      const client = makeClient();
      await client.saveAccount('Work', VALID_CREDS);
      const accounts = await client.listAccounts();
      expect(accounts[0].name).toBe('Work');
      expect(accounts[0].email).toBeUndefined();
    });
  });

  describe('_fetchAccountUsage edge cases', () => {
    it('refreshes expired token and fetches usage', async () => {
      const client = makeClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Err' }));
      await client.saveAccount('Work', EXPIRED_CREDS);

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_REFRESH_RESPONSE })
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_USAGE })
      );
      const result = await client.getAccountUsage('Work');
      expect(result.error).toBeUndefined();
      if (result.accountType === 'oauth') {
        expect(result.session.percent).toBe(0.5);
      }
    });

    it('returns error when expired token refresh fails', async () => {
      const client = makeClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Err' }));
      await client.saveAccount('Work', EXPIRED_CREDS);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
      const result = await client.getAccountUsage('Work');
      expect(result.error).toBe('Token expired — refresh failed');
    });

    it('proactively refreshes token near expiry', async () => {
      const client = makeClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Err' }));
      await client.saveAccount('Work', NEAR_EXPIRED_CREDS);

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_REFRESH_RESPONSE })
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_USAGE })
      );
      const result = await client.getAccountUsage('Work');
      expect(result.error).toBeUndefined();
      if (result.accountType === 'oauth') {
        expect(result.session.percent).toBe(0.5);
      }
    });

    it('continues without refresh when proactive refresh fails', async () => {
      const client = makeClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Err' }));
      await client.saveAccount('Work', NEAR_EXPIRED_CREDS);

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_USAGE })
      );
      const result = await client.getAccountUsage('Work');
      expect(result.error).toBeUndefined();
      if (result.accountType === 'oauth') {
        expect(result.session.percent).toBe(0.5);
      }
    });

    it('returns error when credentials have no access token', async () => {
      const client = makeClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Err' }));
      await client.saveAccount('Work', NO_TOKEN_CREDS);

      const result = await client.getAccountUsage('Work');
      expect(result.error).toBe('No access token');
    });

    it('retries with refresh on AuthenticationError', async () => {
      const client = makeClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Err' }));
      await client.saveAccount('Work', VALID_CREDS);

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' })
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_REFRESH_RESPONSE })
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_USAGE })
      );
      const result = await client.getAccountUsage('Work');
      expect(result.error).toBeUndefined();
      if (result.accountType === 'oauth') {
        expect(result.session.percent).toBe(0.5);
      }
    });

    it('returns auth error when retry refresh also fails', async () => {
      const client = makeClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Err' }));
      await client.saveAccount('Work', VALID_CREDS);

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' })
        .mockResolvedValueOnce({ ok: false, status: 400 })
      );
      const result = await client.getAccountUsage('Work');
      expect(result.error).toBe('Authentication failed');
    });

    it('returns auth error when retry refresh throws', async () => {
      const client = makeClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Err' }));
      await client.saveAccount('Work', VALID_CREDS);

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' })
        .mockRejectedValueOnce(new Error('Network error'))
      );
      const result = await client.getAccountUsage('Work');
      expect(result.error).toBe('Authentication failed');
    });

    it('returns generic error on non-auth fetch failure', async () => {
      const client = makeClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Err' }));
      await client.saveAccount('Work', VALID_CREDS);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' }));
      const result = await client.getAccountUsage('Work');
      expect(result.error).toBe('API error: 500 Server Error');
    });

    it('falls through to auth error when retry usage also fails', async () => {
      const client = makeClient();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Err' }));
      await client.saveAccount('Work', VALID_CREDS);

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' })
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_REFRESH_RESPONSE })
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Down' })
      );
      const result = await client.getAccountUsage('Work');
      expect(result.error).toBe('Authentication failed');
    });
  });

  describe('saveAdminAccount', () => {
    it('saves admin account with valid key', async () => {
      vi.mocked(fetchMessagesUsage).mockResolvedValue([]);
      const client = makeClient();
      await client.saveAdminAccount('Admin', ADMIN_KEY);
      const accounts = await client.listAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe('Admin');
      expect(accounts[0].accountType).toBe('admin');
    });

    it('rejects invalid admin key format', async () => {
      const client = makeClient();
      await expect(client.saveAdminAccount('Admin', 'sk-ant-api03-wrong')).rejects.toThrow(
        'Invalid admin API key format'
      );
    });

    it('propagates API errors from validation', async () => {
      vi.mocked(fetchMessagesUsage).mockRejectedValue(new AuthenticationError(401));
      const client = makeClient();
      await expect(client.saveAdminAccount('Admin', ADMIN_KEY)).rejects.toBeInstanceOf(AuthenticationError);
    });
  });

  describe('admin account usage', () => {
    it('fetches Claude Code usage for admin account', async () => {
      vi.mocked(fetchMessagesUsage).mockResolvedValue([]);
      const client = makeClient();
      await client.saveAdminAccount('Admin', ADMIN_KEY);

      vi.mocked(fetchMessagesUsage).mockResolvedValue(MOCK_ADMIN_ENTRIES);
      const result = await client.getAccountUsage('Admin');
      expect(result.accountType).toBe('admin');
      if (result.accountType === 'admin') {
        expect(result.inputTokens).toBe(5000);
        expect(result.outputTokens).toBe(1000);
        expect(result.estimatedCostCents).toBe(3);
        expect(result.modelBreakdown).toHaveLength(1);
        expect(result.actors).toHaveLength(1);
        expect(result.actors[0].actorType).toBe('api_key');
        expect(result.actors[0].actorName).toBe('my-key');
      }
    });

    it('returns error on admin API failure', async () => {
      vi.mocked(fetchMessagesUsage).mockResolvedValue([]);
      const client = makeClient();
      await client.saveAdminAccount('Admin', ADMIN_KEY);

      vi.mocked(fetchMessagesUsage).mockRejectedValue(new Error('Network error'));
      const result = await client.getAccountUsage('Admin');
      expect(result.accountType).toBe('admin');
      expect(result.error).toBe('Network error');
    });

    it('includes both oauth and admin in getAllAccountsUsage', async () => {
      vi.mocked(fetchMessagesUsage).mockResolvedValue([]);

      const client = makeClient();
      await client.saveAccount('OAuth', VALID_CREDS);
      await client.saveAdminAccount('Admin', ADMIN_KEY);

      vi.mocked(fetchMessagesUsage).mockResolvedValue(MOCK_ADMIN_ENTRIES);
      const results = await client.getAllAccountsUsage();
      expect(results).toHaveLength(2);

      const types = results.map(r => r.accountType).sort();
      expect(types).toEqual(['admin', 'oauth']);
    });
  });

  describe('listAccounts with accountType', () => {
    it('shows oauth type for regular accounts', async () => {
      const client = makeClient();
      await client.saveAccount('Work', VALID_CREDS);
      const accounts = await client.listAccounts();
      expect(accounts[0].accountType).toBe('oauth');
    });

    it('shows admin type for admin accounts', async () => {
      vi.mocked(fetchMessagesUsage).mockResolvedValue([]);
      const client = makeClient();
      await client.saveAdminAccount('Admin', ADMIN_KEY);
      const accounts = await client.listAccounts();
      expect(accounts[0].accountType).toBe('admin');
    });
  });

  describe('refreshToken', () => {
    it('re-authenticates via OAuth and saves new credentials', async () => {
      vi.mocked(authorize).mockResolvedValue(VALID_CREDS);
      const client = makeClient();
      await client.saveAccount('Work', VALID_CREDS);

      await client.refreshToken('Work');

      // Verify authorize was called (OAuth browser flow)
      expect(authorize).toHaveBeenCalled();

      const accounts = await client.listAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe('Work');
    });

    it('throws for unknown account', async () => {
      await expect(makeClient().refreshToken('NoSuch')).rejects.toBeInstanceOf(AccountNotFoundError);
    });

    it('throws for admin accounts', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [], has_more: false }) })
      );
      const client = makeClient();
      await client.saveAdminAccount('Admin', ADMIN_KEY);
      await expect(client.refreshToken('Admin')).rejects.toThrow('Cannot refresh token for an admin account');
    });
  });
});
