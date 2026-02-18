// tests/storage/index.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../../src/storage/index.js';

let tmpDir: string;
let store: AccountStore;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'claude-usage-test-'));
  store = new AccountStore(join(tmpDir, 'accounts.enc'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('AccountStore', () => {
  it('starts empty', async () => {
    const data = await store.load();
    expect(data.accounts).toEqual([]);
    expect(data.activeAccountName).toBeNull();
  });

  it('saves and retrieves an account', async () => {
    await store.saveAccount('Work', '{"claudeAiOauth":{"accessToken":"tok"}}');
    const data = await store.load();
    expect(data.accounts).toHaveLength(1);
    expect(data.accounts[0].name).toBe('Work');
    expect(data.accounts[0].credentials).toBe('{"claudeAiOauth":{"accessToken":"tok"}}');
  });

  it('updates an existing account', async () => {
    await store.saveAccount('Work', 'creds-v1');
    await store.saveAccount('Work', 'creds-v2');
    const data = await store.load();
    expect(data.accounts).toHaveLength(1);
    expect(data.accounts[0].credentials).toBe('creds-v2');
  });

  it('deletes an account', async () => {
    await store.saveAccount('Work', 'creds');
    await store.saveAccount('Personal', 'creds2');
    const deleted = await store.deleteAccount('Work');
    expect(deleted).toBe(true);
    const data = await store.load();
    expect(data.accounts).toHaveLength(1);
    expect(data.accounts[0].name).toBe('Personal');
  });

  it('returns false when deleting nonexistent account', async () => {
    const deleted = await store.deleteAccount('NoSuch');
    expect(deleted).toBe(false);
  });

  it('sets and clears active account', async () => {
    await store.saveAccount('Work', 'creds');
    await store.setActiveAccount('Work');
    let data = await store.load();
    expect(data.activeAccountName).toBe('Work');
    await store.setActiveAccount(null);
    data = await store.load();
    expect(data.activeAccountName).toBeNull();
  });

  it('persists across instances', async () => {
    const path = join(tmpDir, 'accounts.enc');
    const store1 = new AccountStore(path);
    await store1.saveAccount('Work', 'creds');
    const store2 = new AccountStore(path);
    const data = await store2.load();
    expect(data.accounts[0].name).toBe('Work');
  });
});
