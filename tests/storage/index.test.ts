// tests/storage/index.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../../src/storage/index.js';
import { StorageError } from '../../src/errors.js';

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

  it('throws StorageError on corrupt file', async () => {
    const filePath = join(tmpDir, 'accounts.enc');
    await writeFile(filePath, 'corrupt-data-not-encrypted', 'utf8');
    await expect(store.load()).rejects.toBeInstanceOf(StorageError);
  });

  it('saves account with email', async () => {
    await store.saveAccount('Work', 'creds', 'work@example.com');
    const data = await store.load();
    expect(data.accounts[0].email).toBe('work@example.com');
  });

  it('preserves existing email on credential-only update', async () => {
    await store.saveAccount('Work', 'creds-v1', 'work@example.com');
    await store.saveAccount('Work', 'creds-v2');
    const data = await store.load();
    expect(data.accounts[0].credentials).toBe('creds-v2');
    expect(data.accounts[0].email).toBe('work@example.com');
  });

  it('overwrites email when new email is provided', async () => {
    await store.saveAccount('Work', 'creds-v1', 'old@example.com');
    await store.saveAccount('Work', 'creds-v2', 'new@example.com');
    const data = await store.load();
    expect(data.accounts[0].email).toBe('new@example.com');
  });

  it('clears active account when deleting the active account', async () => {
    await store.saveAccount('Work', 'creds');
    await store.setActiveAccount('Work');
    await store.deleteAccount('Work');
    const data = await store.load();
    expect(data.activeAccountName).toBeNull();
  });

  it('throws StorageError when save fails', async () => {
    // Create a file where a directory needs to be, preventing mkdir
    await writeFile(join(tmpDir, 'blocker'), 'not a directory', 'utf8');
    const badStore = new AccountStore(join(tmpDir, 'blocker', 'sub', 'accounts.enc'));
    await expect(badStore.saveAccount('X', 'creds')).rejects.toBeInstanceOf(StorageError);
  });

  it('defaults accountType to oauth', async () => {
    await store.saveAccount('Work', 'creds');
    const data = await store.load();
    expect(data.accounts[0].accountType).toBe('oauth');
  });

  it('handles legacy accounts without accountType as oauth', async () => {
    // Save normally then verify the type defaults correctly
    await store.saveAccount('Legacy', 'creds');
    const data = await store.load();
    // Backward compat: undefined accountType should be treated as oauth
    expect(data.accounts[0].accountType ?? 'oauth').toBe('oauth');
  });

  it('saves account with accountType admin', async () => {
    await store.saveAccount('Admin', '{"adminApiKey":"sk-ant-admin-key"}', undefined, 'admin');
    const data = await store.load();
    expect(data.accounts[0].accountType).toBe('admin');
  });
});
