# Design: Wrap `claude setup-token` for Authorization

**Date:** 2026-02-23

## Problem

The current `authorize()` implementation uses a custom OAuth PKCE flow that calls the `create_api_key` endpoint to obtain a long-lived token. This endpoint returns 403 for personal accounts ("OAuth token does not meet scope requirement org:create_api_key"), causing a silent fallback to short-lived tokens. The `client.refreshToken()` path then re-runs the same broken flow.

## Decision

Replace the custom OAuth PKCE flow with a thin wrapper around the `claude setup-token` CLI command, which already handles the full OAuth flow and produces a long-lived API key (`sk-ant-...`). The CLI prints the raw token to stdout on its own line after authentication completes.

## Approach

Spawn `claude setup-token` as a child process with `stdio: ['inherit', 'pipe', 'inherit']` so the user can interact with the terminal (see progress, browser prompt) while stdout is captured for token parsing. Scan stdout for a line matching `/^sk-ant-[A-Za-z0-9_-]+$/m`. Return a `ClaudeCredentials` object with `accessToken = <token>`, `refreshToken = ''`, and `expiresAt = now + 1 year`.

## Changes

### `src/auth/index.ts`
- Rewrite `authorize()` to spawn `claude setup-token`, parse stdout for the token, return `ClaudeCredentials`
- `AuthorizeOptions`: keep `timeoutMs?`, replace `_openBrowser` with `_claudeCommand?: string` (defaults to `'claude'`, injectable for testing)
- Remove `requireLongLived` option — always long-lived now
- Remove all PKCE code: `generatePKCE()`, `AUTHORIZE_URL`, `SCOPES`, `BETA_HEADER`, `CREATE_API_KEY_URL`, `createLongLivedToken()`, `SUCCESS_HTML`, HTTP server, `TokenResponse`, `CreateApiKeyResponse`
- Keep `OAUTH_CLIENT_ID` and `OAUTH_TOKEN_URL` exports (consumed by `tokens/refreshToken()`)

### `src/client.ts`
- `refreshToken(name)`: remove `{ requireLongLived: true }` from the `authenticate()` call

### `src/tokens/index.ts`
- No changes. `refreshToken()` already handles missing refresh token gracefully (`{ success: false, error: 'No refresh token' }`), which surfaces as `'Token expired — refresh failed'` — the correct signal to call `client.refreshToken(name)`.

### Scripts
- Delete `scripts/test-create-key.ts` — tests the now-removed `create_api_key` approach
- Delete `scripts/test-refresh.ts` — tests the now-removed PKCE flow

## Token Lifecycle

Long-lived tokens (~1 year) make the `tokens/refreshToken()` OAuth refresh path a no-op for new accounts. When a token expires after ~1 year, `_fetchOAuthAccountUsage()` surfaces `'Token expired — refresh failed'` and the user calls `client.refreshToken(name)`, which re-runs `claude setup-token`.

## Testing

- Mock `_claudeCommand` to point at a test script that prints a fake `sk-ant-...` token to stdout
- Test: token parsed correctly from stdout
- Test: non-zero exit code throws `AuthenticationError`
- Test: no matching line in stdout throws `AuthenticationError`
- Test: `timeoutMs` respected
