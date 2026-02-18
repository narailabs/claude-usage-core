// tests/credentials/windows.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WindowsCredentialReader } from '../../src/credentials/windows.js';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execSync: vi.fn() }));

import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
const mockReadFile = vi.mocked(readFile);
const mockExecSync = vi.mocked(execSync);

describe('WindowsCredentialReader', () => {
  const reader = new WindowsCredentialReader();

  beforeEach(() => vi.clearAllMocks());

  it('reads from credentials file when it exists', async () => {
    const creds = JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } });
    mockReadFile.mockResolvedValue(creds as unknown as Buffer);
    const result = await reader.read();
    expect(result).toBe(creds);
  });

  it('returns null when file missing and cmdkey fails', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error(), { code: 'ENOENT' }));
    mockExecSync.mockImplementation(() => { throw new Error(); });
    const result = await reader.read();
    expect(result).toBeNull();
  });
});
