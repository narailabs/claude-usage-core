// tests/tokens/index.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateToken, refreshToken } from '../../src/tokens/index.js';

describe('validateToken', () => {
  it('returns valid for non-expired token', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const creds = JSON.stringify({ claudeAiOauth: { accessToken: 'tok', refreshToken: 'rt', expiresAt: future } });
    const result = validateToken(creds);
    expect(result.isValid).toBe(true);
    expect(result.isExpired).toBe(false);
    expect(result.minutesUntilExpiry).toBeGreaterThan(50);
  });

  it('returns expired for past token', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const creds = JSON.stringify({ claudeAiOauth: { accessToken: 'tok', refreshToken: 'rt', expiresAt: past } });
    const result = validateToken(creds);
    expect(result.isExpired).toBe(true);
    expect(result.isValid).toBe(false);
  });

  it('returns invalid for missing expiresAt', () => {
    const creds = JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } });
    const result = validateToken(creds);
    expect(result.isValid).toBe(false);
    expect(result.expiresAt).toBeNull();
  });

  it('returns invalid for malformed JSON', () => {
    const result = validateToken('not-valid-json');
    expect(result.isValid).toBe(false);
    expect(result.isExpired).toBe(false);
    expect(result.expiresAt).toBeNull();
    expect(result.minutesUntilExpiry).toBeNull();
  });
});

describe('refreshToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns new credentials on success', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-tok',
        refresh_token: 'new-rt',
        expires_in: 3600,
      }),
    }));

    const oldCreds = JSON.stringify({
      claudeAiOauth: { accessToken: 'old', refreshToken: 'rt', expiresAt: future }
    });

    const result = await refreshToken(oldCreds);
    expect(result.success).toBe(true);
    if (result.success) {
      const parsed = JSON.parse(result.newCredentials);
      expect(parsed.claudeAiOauth.accessToken).toBe('new-tok');
    }
  });

  it('returns failure on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    }));

    const creds = JSON.stringify({ claudeAiOauth: { accessToken: 'old', refreshToken: 'rt', expiresAt: '' } });
    const result = await refreshToken(creds);
    expect(result.success).toBe(false);
  });

  it('returns failure when no refresh token in creds', async () => {
    const creds = JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } });
    const result = await refreshToken(creds);
    expect(result.success).toBe(false);
    expect(result.error).toBe('No refresh token');
  });

  it('returns failure on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const creds = JSON.stringify({ claudeAiOauth: { accessToken: 'tok', refreshToken: 'rt', expiresAt: '' } });
    const result = await refreshToken(creds);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Network error');
  });
});
