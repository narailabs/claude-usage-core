// tests/auth/index.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { authorize, OAUTH_CLIENT_ID, OAUTH_TOKEN_URL } from '../../src/auth/index.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

import { spawn } from 'node:child_process';

const FAKE_TOKEN = 'sk-ant-oat01-fake-long-lived-token-abc123';

function makeChild(output: string, exitCode: number | null = 0) {
  const child = new EventEmitter() as ReturnType<typeof spawn>;
  const stdout = new EventEmitter();
  (child as any).stdout = stdout;
  (child as any).kill = vi.fn();
  setImmediate(() => {
    stdout.emit('data', Buffer.from(output));
    child.emit('close', exitCode);
  });
  return child;
}

describe('authorize', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('spawns claude setup-token and returns credentials from stdout token', async () => {
    vi.mocked(spawn).mockReturnValue(makeChild(`Setting up...\n${FAKE_TOKEN}\nDone.\n`));

    const result = await authorize();
    const creds = JSON.parse(result);

    expect(creds.claudeAiOauth.accessToken).toBe(FAKE_TOKEN);
    expect(creds.claudeAiOauth.refreshToken).toBe('');
    const expiry = new Date(creds.claudeAiOauth.expiresAt);
    expect(expiry.getTime()).toBeGreaterThan(Date.now() + 364 * 24 * 60 * 60 * 1000);
    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      'claude', ['setup-token'],
      expect.objectContaining({ stdio: ['inherit', 'pipe', 'inherit'] })
    );
  });

  it('uses _claudeCommand override', async () => {
    vi.mocked(spawn).mockReturnValue(makeChild(`${FAKE_TOKEN}\n`));

    await authorize({ _claudeCommand: '/custom/path/claude' });

    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      '/custom/path/claude', ['setup-token'],
      expect.anything()
    );
  });

  it('throws when process exits non-zero', async () => {
    vi.mocked(spawn).mockReturnValue(makeChild('Error: something went wrong\n', 1));

    await expect(authorize()).rejects.toThrow('exited with code 1');
  });

  it('throws when stdout has no token', async () => {
    vi.mocked(spawn).mockReturnValue(makeChild('Setup complete. Token saved to keychain.\n'));

    await expect(authorize()).rejects.toThrow('No token found');
  });

  it('throws and kills process on timeout', async () => {
    const child = new EventEmitter() as ReturnType<typeof spawn>;
    const stdout = new EventEmitter();
    (child as any).stdout = stdout;
    const killSpy = vi.fn();
    (child as any).kill = killSpy;
    // Never emits close — simulates a hung process
    vi.mocked(spawn).mockReturnValue(child);

    await expect(authorize({ timeoutMs: 100 })).rejects.toThrow('timed out');
    expect(killSpy).toHaveBeenCalled();
  });

  it('throws on spawn error', async () => {
    const child = new EventEmitter() as ReturnType<typeof spawn>;
    const stdout = new EventEmitter();
    (child as any).stdout = stdout;
    (child as any).kill = vi.fn();
    setImmediate(() => child.emit('error', new Error('spawn ENOENT')));
    vi.mocked(spawn).mockReturnValue(child);

    await expect(authorize()).rejects.toThrow('spawn ENOENT');
  });

  it('still exports OAUTH_CLIENT_ID and OAUTH_TOKEN_URL', () => {
    expect(OAUTH_CLIENT_ID).toMatch(/^[0-9a-f-]+$/);
    expect(OAUTH_TOKEN_URL).toMatch(/^https:/);
  });
});
