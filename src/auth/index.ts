// src/auth/index.ts — OAuth authorization code flow with PKCE
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { exec } from 'node:child_process';
import type { ClaudeCredentials } from '../types.js';

export const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';

const AUTHORIZE_URL = 'https://platform.claude.com/oauth/authorize';
const SCOPES = 'user:profile user:inference';
const TIMEOUT_MS = 120_000;

export interface AuthorizeOptions {
  /** Override the timeout in milliseconds (default 120s) */
  timeoutMs?: number;
  /** @internal Override browser opener for testing */
  _openBrowser?: (url: string) => void;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Generate a base64url-encoded random string */
function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/** Generate PKCE code_verifier and code_challenge (S256) */
export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

/** Open a URL in the default browser */
function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? `open "${url}"` :
    process.platform === 'win32' ? `start "" "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd, () => { /* ignore errors — user can open manually */ });
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><title>Authenticated</title></head>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1>Authenticated</h1><p>You can close this tab.</p></div>
</body></html>`;

/**
 * Run the full OAuth authorization code flow with PKCE.
 * Opens the user's browser, waits for the callback, exchanges the code for tokens,
 * and returns a ClaudeCredentials JSON string.
 */
export async function authorize(options?: AuthorizeOptions): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? TIMEOUT_MS;
  const openFn = options?._openBrowser ?? openBrowser;
  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = base64url(randomBytes(32));

  return new Promise<string>((resolve, reject) => {
    const server = createServer();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
        reject(new Error('OAuth authorization timed out'));
      }
    }, timeoutMs);

    server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      if (settled) return;

      const url = new URL(req.url!, `http://localhost`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        settled = true;
        clearTimeout(timer);
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(`<h1>Error: ${error}</h1>`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (returnedState !== state) {
        settled = true;
        clearTimeout(timer);
        res.writeHead(400, { 'Content-Type': 'text/html' }).end('<h1>State mismatch</h1>');
        server.close();
        reject(new Error('OAuth state mismatch'));
        return;
      }

      if (!code) {
        settled = true;
        clearTimeout(timer);
        res.writeHead(400, { 'Content-Type': 'text/html' }).end('<h1>Missing code</h1>');
        server.close();
        reject(new Error('OAuth callback missing code'));
        return;
      }

      // Serve the success page immediately
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(SUCCESS_HTML);

      const port = (server.address() as { port: number }).port;
      const redirectUri = `http://localhost:${port}/callback`;

      try {
        const tokenRes = await fetch(OAUTH_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            client_id: OAUTH_CLIENT_ID,
            code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
            state,
          }),
        });

        if (!tokenRes.ok) {
          const body = await tokenRes.text();
          throw new Error(`Token exchange failed: HTTP ${tokenRes.status} — ${body}`);
        }

        const data = (await tokenRes.json()) as TokenResponse;
        const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

        const credentials: ClaudeCredentials = {
          claudeAiOauth: {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt,
          },
        };

        settled = true;
        clearTimeout(timer);
        server.close();
        resolve(JSON.stringify(credentials));
      } catch (err) {
        settled = true;
        clearTimeout(timer);
        server.close();
        reject(err);
      }
    });

    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      const redirectUri = `http://localhost:${port}/callback`;
      const params = new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
      });
      const authorizeUrl = `${AUTHORIZE_URL}?${params}`;
      console.log(`Opening browser for authentication...`);
      console.log(`If the browser doesn't open, visit: ${authorizeUrl}`);
      openFn(authorizeUrl);
    });
  });
}
