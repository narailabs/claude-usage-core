// tests/client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeUsageClient } from '../src/client.js';
import { AccountNotFoundError } from '../src/errors.js';

// Mock credential reader and fetch
vi.mock('../src/credentials/index.js', () => ({
  createCredentialReader: vi.fn(() => ({ read: vi.fn().mockResolvedValue(null) })),
}));

const MOCK_USAGE = {
  five_hour: { utilization: 0.5, resets_at: null },
  seven_day: { utilization: 0.3, resets_at: null },
  seven_day_opus: null,
};

const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const VALID_CREDS = JSON.stringify({
  claudeAiOauth: { accessToken: 'tok', refreshToken: 'rt', expiresAt: FUTURE }
});

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'claude-usage-client-test-'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => MOCK_USAGE,
  }));
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
      expect(result.session.percent).toBe(0.5);
    });

    it('throws AccountNotFoundError for unknown account', async () => {
      await expect(makeClient().getAccountUsage('NoSuch')).rejects.toBeInstanceOf(AccountNotFoundError);
    });
  });
});
