# Wrap `claude setup-token` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the custom OAuth PKCE flow in `authorize()` with a thin wrapper around `claude setup-token`, which prints a long-lived `sk-ant-...` token to stdout after the user authenticates in their browser.

**Architecture:** `authorize()` spawns `claude setup-token` with `stdio: ['inherit', 'pipe', 'inherit']` so the user's terminal is passed through for browser prompts while stdout is captured. After the process exits cleanly, stdout is scanned for a line matching `/^sk-ant-\S+$/m`. The token is stored with a 1-year expiry; there is no refresh token. All PKCE code is deleted.

**Tech Stack:** Node.js `child_process.spawn`, vitest, TypeScript

---

### Task 1: Replace auth tests

**Files:**
- Modify: `tests/auth/index.test.ts`

**Step 1: Replace entire test file with new tests**

```typescript
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

  it('throws AuthenticationError when process exits non-zero', async () => {
    vi.mocked(spawn).mockReturnValue(makeChild('Error: something went wrong\n', 1));

    await expect(authorize()).rejects.toThrow('exited with code 1');
  });

  it('throws AuthenticationError when stdout has no token', async () => {
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

  it('throws AuthenticationError on spawn error', async () => {
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
```

**Step 2: Run tests to confirm they fail (source not yet changed)**

```bash
npx vitest run tests/auth/index.test.ts
```

Expected: Multiple failures — `generatePKCE is not a function`, `spawn not called`, etc.

**Step 3: Commit the failing tests**

```bash
git add tests/auth/index.test.ts
git commit -m "test: replace PKCE auth tests with claude setup-token spawn tests"
```

---

### Task 2: Rewrite `src/auth/index.ts`

**Files:**
- Modify: `src/auth/index.ts`

**Step 1: Replace the entire file**

```typescript
// src/auth/index.ts — authorize via `claude setup-token` CLI
import { spawn } from 'node:child_process';
import { AuthenticationError } from '../errors.js';
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
 * the resulting `sk-ant-...` token to stdout on its own line.
 * Returns a ClaudeCredentials JSON string with a ~1-year expiry.
 */
export async function authorize(options?: AuthorizeOptions): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? TIMEOUT_MS;
  const claudeCommand = options?._claudeCommand ?? 'claude';

  return new Promise<string>((resolve, reject) => {
    const child = spawn(claudeCommand, ['setup-token'], {
      stdio: ['inherit', 'pipe', 'inherit'],
    });

    let stdout = '';

    (child.stdout as NodeJS.ReadableStream).on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    const timer = setTimeout(() => {
      (child as any).kill();
      reject(new AuthenticationError('claude setup-token timed out'));
    }, timeoutMs);

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(new AuthenticationError(`Failed to run claude setup-token: ${err.message}`));
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);

      if (code !== 0) {
        reject(new AuthenticationError(`claude setup-token exited with code ${code}`));
        return;
      }

      const match = stdout.match(/^(sk-ant-\S+)$/m);
      if (!match) {
        reject(new AuthenticationError('No token found in claude setup-token output'));
        return;
      }

      const credentials: ClaudeCredentials = {
        claudeAiOauth: {
          accessToken: match[1],
          refreshToken: '',
          expiresAt: new Date(Date.now() + ONE_YEAR_MS).toISOString(),
        },
      };

      resolve(JSON.stringify(credentials));
    });
  });
}
```

**Step 2: Run auth tests — they should pass now**

```bash
npx vitest run tests/auth/index.test.ts
```

Expected: All tests PASS.

**Step 3: Run full test suite to check for regressions**

```bash
npm test
```

Expected: All tests pass (client.test.ts mocks `authorize`, so it's unaffected by the rewrite).

**Step 4: Commit**

```bash
git add src/auth/index.ts
git commit -m "feat: replace PKCE OAuth flow with claude setup-token wrapper"
```

---

### Task 3: Update `src/client.ts`

**Files:**
- Modify: `src/client.ts:122-123`

**Step 1: Remove `requireLongLived: true` from the `refreshToken` method**

In `src/client.ts`, find this block:

```typescript
    // Re-authenticate via OAuth browser flow (requires long-lived ~1yr token)
    await this.authenticate(name, { requireLongLived: true });
```

Replace with:

```typescript
    // Re-authenticate via claude setup-token
    await this.authenticate(name);
```

**Step 2: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

**Step 3: Commit**

```bash
git add src/client.ts
git commit -m "chore: remove requireLongLived option from refreshToken (always long-lived now)"
```

---

### Task 4: Delete stale scripts and update docs

**Files:**
- Delete: `scripts/test-create-key.ts`
- Delete: `scripts/test-refresh.ts`
- Modify: `CLAUDE.md`

**Step 1: Delete stale diagnostic scripts**

```bash
git rm scripts/test-create-key.ts scripts/test-refresh.ts
```

**Step 2: Update CLAUDE.md auth section**

In `CLAUDE.md`, find:

```
- **`src/auth/`** — OAuth authorization code flow with PKCE. `authorize()` opens the browser, listens for the callback, exchanges the code for tokens, and returns a `ClaudeCredentials` JSON string. Also exports `generatePKCE()` and the OAuth constants (`OAUTH_CLIENT_ID`, `OAUTH_TOKEN_URL`).
```

Replace with:

```
- **`src/auth/`** — Authorizes by spawning `claude setup-token`, which opens the browser and prints a long-lived `sk-ant-...` token to stdout. `authorize()` captures that token and returns a `ClaudeCredentials` JSON string with a ~1-year expiry. Also exports `OAUTH_CLIENT_ID` and `OAUTH_TOKEN_URL` (used by `tokens/`).
```

**Step 3: Run tests one final time**

```bash
npm test
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete stale diagnostic scripts, update CLAUDE.md for setup-token approach"
```
