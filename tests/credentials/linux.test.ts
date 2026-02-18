// tests/credentials/linux.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinuxCredentialReader } from '../../src/credentials/linux.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));
vi.mock('node:child_process', () => ({ execSync: vi.fn() }));

import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
const mockReadFile = vi.mocked(readFile);
const mockExecSync = vi.mocked(execSync);

describe('LinuxCredentialReader', () => {
  const reader = new LinuxCredentialReader();

  beforeEach(() => vi.clearAllMocks());

  it('reads from credentials file when it exists', async () => {
    const creds = JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } });
    mockReadFile.mockResolvedValue(creds as unknown as Buffer);
    const result = await reader.read();
    expect(result).toBe(creds);
  });

  it('falls back to secret-tool when file not found', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error(), { code: 'ENOENT' }));
    const creds = JSON.stringify({ claudeAiOauth: { accessToken: 'tok2' } });
    mockExecSync.mockReturnValue(creds + '\n');
    const result = await reader.read();
    expect(result).toBe(creds);
  });

  it('returns null when both sources fail', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error(), { code: 'ENOENT' }));
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    const result = await reader.read();
    expect(result).toBeNull();
  });
});
