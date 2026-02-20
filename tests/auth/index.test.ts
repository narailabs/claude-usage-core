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

  it('exchanges code for tokens and returns credentials JSON', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'test-access-tok',
        refresh_token: 'test-refresh-tok',
        expires_in: 3600,
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

    expect(parsed.claudeAiOauth.accessToken).toBe('test-access-tok');
    expect(parsed.claudeAiOauth.refreshToken).toBe('test-refresh-tok');
    expect(parsed.claudeAiOauth.expiresAt).toBeDefined();

    // Verify the token exchange request
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [fetchUrl, fetchOpts] = fetchSpy.mock.calls[0];
    expect(fetchUrl).toBe(OAUTH_TOKEN_URL);
    const body = JSON.parse(fetchOpts.body);
    expect(body.grant_type).toBe('authorization_code');
    expect(body.client_id).toBe(OAUTH_CLIENT_ID);
    expect(body.code).toBe('test-code');
    expect(body.code_verifier).toBeDefined();
    expect(body.state).toBeDefined();
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
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'test-tok',
        refresh_token: 'test-rt',
        expires_in: 3600,
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
    expect(JSON.parse(credentials).claudeAiOauth.accessToken).toBe('test-tok');
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
