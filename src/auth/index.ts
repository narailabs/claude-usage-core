// src/auth/index.ts — authorize via `claude setup-token` CLI
import { spawn } from 'node:child_process';
import type { ClaudeCredentials } from '../types.js';

export const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';

const TIMEOUT_MS = 120_000;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export interface AuthorizeOptions {
  /** Override the timeout in milliseconds (default 120s) */
  timeoutMs?: number;
  /** @internal Override the claude binary path for testing */
  _claudeCommand?: string;
}

/**
 * Obtain a long-lived token by running `claude setup-token`.
 * The CLI opens the user's browser, handles the OAuth flow, and prints
 * the resulting `sk-ant-...` token to stdout.
 * Returns a ClaudeCredentials JSON string with a ~1-year expiry.
 */
export async function authorize(options?: AuthorizeOptions): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? TIMEOUT_MS;
  const claudeCommand = options?._claudeCommand ?? 'claude';

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const settle = (fn: (v: any) => void, value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const child = spawn(claudeCommand, ['setup-token'], {
      stdio: ['inherit', 'pipe', 'inherit'],
    });

    let stdout = '';

    (child.stdout as NodeJS.ReadableStream).on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    timer = setTimeout(() => {
      (child as any).kill();
      settle(reject, new Error('claude setup-token timed out'));
    }, timeoutMs);

    child.on('error', (err: Error) => {
      settle(reject, new Error(`Failed to run claude setup-token: ${err.message}`));
    });

    child.on('close', (code: number | null) => {
      if (code !== 0) {
        settle(reject, new Error(`claude setup-token exited with code ${code}`));
        return;
      }

      const match = stdout.match(/(sk-ant-\S+)/);
      if (!match) {
        settle(reject, new Error('No token found in claude setup-token output'));
        return;
      }

      const credentials: ClaudeCredentials = {
        claudeAiOauth: {
          accessToken: match[1],
          refreshToken: '',
          expiresAt: new Date(Date.now() + ONE_YEAR_MS).toISOString(),
        },
      };

      settle(resolve, JSON.stringify(credentials));
    });
  });
}
