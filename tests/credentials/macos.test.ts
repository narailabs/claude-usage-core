// tests/credentials/macos.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MacOSCredentialReader } from '../../src/credentials/macos.js';

// We mock child_process because we can't rely on a real keychain in CI
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
const mockExecSync = vi.mocked(execSync);

describe('MacOSCredentialReader', () => {
  const reader = new MacOSCredentialReader();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw credentials JSON when found', async () => {
    const creds = JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } });
    mockExecSync.mockReturnValue(creds + '\n');
    const result = await reader.read();
    expect(result).toBe(creds);
  });

  it('returns null when keychain entry not found', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('could not be found in the keychain');
    });
    const result = await reader.read();
    expect(result).toBeNull();
  });

  it('returns null on permission denied', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('InteractionNotAllowed');
    });
    const result = await reader.read();
    expect(result).toBeNull();
  });
});
