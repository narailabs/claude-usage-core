// src/storage/index.ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { encrypt, decrypt } from './crypto.js';
import { StorageError } from '../errors.js';
import type { AccountsData, SavedAccount } from '../types.js';

const EMPTY: AccountsData = { accounts: [], activeAccountName: null };

export class AccountStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<AccountsData> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const decrypted = await decrypt(raw.trim());
      return JSON.parse(decrypted) as AccountsData;
    } catch (err) {
      // File not found = fresh state
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return structuredClone(EMPTY);
      }
      throw new StorageError(`Failed to load accounts: ${(err as Error).message}`);
    }
  }

  private async save(data: AccountsData): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      const encrypted = await encrypt(JSON.stringify(data));
      await writeFile(this.filePath, encrypted, 'utf8');
    } catch (err) {
      throw new StorageError(`Failed to save accounts: ${(err as Error).message}`);
    }
  }

  async saveAccount(name: string, credentials: string): Promise<void> {
    const data = await this.load();
    const existing = data.accounts.findIndex(a => a.name === name);
    const account: SavedAccount = { name, credentials, savedAt: new Date().toISOString() };
    if (existing >= 0) {
      data.accounts[existing] = account;
    } else {
      data.accounts.push(account);
    }
    await this.save(data);
  }

  async deleteAccount(name: string): Promise<boolean> {
    const data = await this.load();
    const index = data.accounts.findIndex(a => a.name === name);
    if (index < 0) return false;
    data.accounts.splice(index, 1);
    if (data.activeAccountName === name) data.activeAccountName = null;
    await this.save(data);
    return true;
  }

  async setActiveAccount(name: string | null): Promise<void> {
    const data = await this.load();
    data.activeAccountName = name;
    await this.save(data);
  }
}
