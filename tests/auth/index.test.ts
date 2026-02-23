// tests/auth/index.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { exec } from 'node:child_process';
import { generatePKCE, authorize, OAUTH_CLIENT_ID, OAUTH_TOKEN_URL } from '../../src/auth/index.js';

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

describe('generatePKCE', () => {
  it('produces a code_verifier of correct length', () => {
    const { codeVerifier } = generatePKCE();
    // 32 random bytes base64url-encoded = 43 chars
    expect(codeVerifier).toHaveLength(43);
  });

  it('produces a valid S256 code_challenge', async () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    expect(codeChallenge).toBe(expected);
  });

  it('generates unique values each call', () => {
    const a = generatePKCE();
    const b = generatePKCE();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
  });
});

describe('authorize', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  /** Captured authorize URL from the _openBrowser callback */
  let capturedUrl: string;
  const browserSpy = vi.fn((url: string) => { capturedUrl = url; });

  function extractFromUrl(url: string) {
    const parsed = new URL(url);
    const port = parsed.searchParams.get('redirect_uri')!.match(/:(\d+)\//)?.[1];
    const state = parsed.searchParams.get('state')!;
    return { port: port!, state };
  }

  beforeEach(() => {
    capturedUrl = '';
    browserSpy.mockClear();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exchanges code for tokens and returns long-lived credentials', async () => {
    // First call: token exchange; second call: create long-lived API key
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'short-lived-tok',
          refresh_token: 'test-refresh-tok',
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          key: 'sk-ant-oat01-long-lived-key',
          created_at: '2025-01-01T00:00:00Z',
          expires_at: '2026-01-01T00:00:00Z',
        }),
      });

    const authPromise = authorize({ timeoutMs: 5000, _openBrowser: browserSpy });

    // Give the server a moment to start
    await new Promise(r => setTimeout(r, 100));

    expect(browserSpy).toHaveBeenCalledOnce();
    const { port, state } = extractFromUrl(capturedUrl);

    // Simulate the OAuth callback
    await new Promise<void>((resolve, reject) => {
      http.get(
        `http://localhost:${port}/callback?code=test-code&state=${state}`,
        (res) => {
          expect(res.statusCode).toBe(200);
          res.resume();
          res.on('end', resolve);
        },
      ).on('error', reject);
    });

    const credentials = await authPromise;
    const parsed = JSON.parse(credentials);

    // Should use the long-lived key, not the short-lived token
    expect(parsed.claudeAiOauth.accessToken).toBe('sk-ant-oat01-long-lived-key');
    expect(parsed.claudeAiOauth.refreshToken).toBe('test-refresh-tok');
    expect(parsed.claudeAiOauth.expiresAt).toBe('2026-01-01T00:00:00Z');

    // Verify both fetch calls
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // First call: token exchange
    const [tokenUrl, tokenOpts] = fetchSpy.mock.calls[0];
    expect(tokenUrl).toBe(OAUTH_TOKEN_URL);
    const body = JSON.parse(tokenOpts.body);
    expect(body.grant_type).toBe('authorization_code');
    expect(body.client_id).toBe(OAUTH_CLIENT_ID);
    expect(body.code).toBe('test-code');
    expect(body.code_verifier).toBeDefined();
    expect(body.state).toBeDefined();

    // Second call: create long-lived API key
    const [apiKeyUrl, apiKeyOpts] = fetchSpy.mock.calls[1];
    expect(apiKeyUrl).toBe('https://api.anthropic.com/api/oauth/claude_cli/create_api_key');
    expect(apiKeyOpts.headers.Authorization).toBe('Bearer short-lived-tok');
    expect(apiKeyOpts.headers['anthropic-beta']).toBe('oauth-2025-04-20');
    const apiKeyBody = JSON.parse(apiKeyOpts.body);
    expect(apiKeyBody.name).toMatch(/^claude-usage-/);
  });

  it('falls back to short-lived token when long-lived creation fails', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'short-lived-tok',
          refresh_token: 'test-refresh-tok',
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

    const authPromise = authorize({ timeoutMs: 5000, _openBrowser: browserSpy });
    await new Promise(r => setTimeout(r, 100));

    const { port, state } = extractFromUrl(capturedUrl);

    await new Promise<void>((resolve, reject) => {
      http.get(
        `http://localhost:${port}/callback?code=test-code&state=${state}`,
        (res) => { res.resume(); res.on('end', resolve); },
      ).on('error', reject);
    });

    const credentials = await authPromise;
    const parsed = JSON.parse(credentials);

    // Falls back to short-lived token
    expect(parsed.claudeAiOauth.accessToken).toBe('short-lived-tok');
    expect(parsed.claudeAiOauth.refreshToken).toBe('test-refresh-tok');
    // expiresAt should be computed from expires_in, not from the API key response
    expect(parsed.claudeAiOauth.expiresAt).toBeDefined();
  });

  it('rejects on state mismatch', async () => {
    const authPromise = authorize({ timeoutMs: 5000, _openBrowser: browserSpy });
    // Attach rejection handler early to prevent unhandled rejection warning
    const rejection = expect(authPromise).rejects.toThrow('state mismatch');
    await new Promise(r => setTimeout(r, 100));

    const { port } = extractFromUrl(capturedUrl);

    // Send callback with wrong state
    await new Promise<void>((resolve) => {
      http.get(
        `http://localhost:${port}/callback?code=test-code&state=wrong-state`,
        (res) => {
          expect(res.statusCode).toBe(400);
          res.resume();
          res.on('end', resolve);
        },
      );
    });

    await rejection;
  });

  it('rejects on timeout', async () => {
    await expect(
      authorize({ timeoutMs: 200, _openBrowser: browserSpy })
    ).rejects.toThrow('timed out');
  });

  it('rejects when OAuth returns an error', async () => {
    const authPromise = authorize({ timeoutMs: 5000, _openBrowser: browserSpy });
    const rejection = expect(authPromise).rejects.toThrow('access_denied');
    await new Promise(r => setTimeout(r, 100));

    const { port } = extractFromUrl(capturedUrl);

    await new Promise<void>((resolve) => {
      http.get(
        `http://localhost:${port}/callback?error=access_denied`,
        (res) => {
          expect(res.statusCode).toBe(400);
          res.resume();
          res.on('end', resolve);
        },
      );
    });

    await rejection;
  });

  it('returns 404 for non-callback paths', async () => {
    const authPromise = authorize({ timeoutMs: 1000, _openBrowser: browserSpy });
    authPromise.catch(() => {}); // suppress unhandled rejection
    await new Promise(r => setTimeout(r, 100));

    const { port } = extractFromUrl(capturedUrl);

    await new Promise<void>((resolve) => {
      http.get(`http://localhost:${port}/not-callback`, (res) => {
        expect(res.statusCode).toBe(404);
        res.resume();
        res.on('end', resolve);
      });
    });

    await expect(authPromise).rejects.toThrow('timed out');
  });

  it('rejects when callback has no code parameter', async () => {
    const authPromise = authorize({ timeoutMs: 5000, _openBrowser: browserSpy });
    const rejection = expect(authPromise).rejects.toThrow('missing code');
    await new Promise(r => setTimeout(r, 100));

    const { port, state } = extractFromUrl(capturedUrl);

    await new Promise<void>((resolve) => {
      http.get(`http://localhost:${port}/callback?state=${state}`, (res) => {
        expect(res.statusCode).toBe(400);
        res.resume();
        res.on('end', resolve);
      });
    });

    await rejection;
  });

  it('uses default browser opener when _openBrowser not provided', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-tok',
          refresh_token: 'test-rt',
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          key: 'sk-ant-oat01-long-key',
          created_at: '2025-01-01T00:00:00Z',
          expires_at: '2026-01-01T00:00:00Z',
        }),
      });

    const authPromise = authorize({ timeoutMs: 5000 });
    await new Promise(r => setTimeout(r, 100));

    // Default openBrowser should have called exec
    expect(vi.mocked(exec)).toHaveBeenCalledOnce();
    const cmd = vi.mocked(exec).mock.calls[0][0] as string;
    expect(cmd).toMatch(/^open "/); // macOS

    // Extract URL from the exec command to complete the flow
    const urlMatch = cmd.match(/open "(.+)"/);
    const authorizeUrl = urlMatch![1];
    const parsed = new URL(authorizeUrl);
    const port = parsed.searchParams.get('redirect_uri')!.match(/:(\d+)\//)?.[1];
    const state = parsed.searchParams.get('state')!;

    await new Promise<void>((resolve, reject) => {
      http.get(
        `http://localhost:${port}/callback?code=test-code&state=${state}`,
        (res) => { res.resume(); res.on('end', resolve); },
      ).on('error', reject);
    });

    const credentials = await authPromise;
    expect(JSON.parse(credentials).claudeAiOauth.accessToken).toBe('sk-ant-oat01-long-key');
  });

  it('rejects when token exchange fails', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    });

    const authPromise = authorize({ timeoutMs: 5000, _openBrowser: browserSpy });
    const rejection = expect(authPromise).rejects.toThrow('Token exchange failed');
    await new Promise(r => setTimeout(r, 100));

    const { port, state } = extractFromUrl(capturedUrl);

    await new Promise<void>((resolve) => {
      http.get(
        `http://localhost:${port}/callback?code=bad-code&state=${state}`,
        (res) => {
          res.resume();
          res.on('end', resolve);
        },
      );
    });

    await rejection;
  });
});
