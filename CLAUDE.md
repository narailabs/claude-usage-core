# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Build:** `npm run build` (uses tsup, outputs ESM + CJS + .d.ts to `dist/`)
- **Test:** `npm test` (vitest, single run)
- **Test watch:** `npm run test:watch`
- **Single test:** `npx vitest run tests/tokens/index.test.ts`
- **Typecheck:** `npm run typecheck` (tsc --noEmit)

## Architecture

This is a Node.js TypeScript library for monitoring Claude Code usage across multiple accounts. It supports OAuth PKCE-based Claude Code subscription accounts and Anthropic admin API key accounts. It reads OAuth credentials from the OS keychain, stores them encrypted locally, and fetches usage data from the Anthropic API.

### Pipeline flow

```
                    auth/ (OAuth PKCE browser flow)
                         ↓
OS Keychain/Credentials → credentials/ → client.ts → tokens/ (validate/refresh) → usage/ → OAuthAccountUsage
                                            ↕                                                       ↘
                                     storage/ (encrypted account store)                        AccountUsage (union)
                                            ↕                                                       ↗
                                         client.ts ─────── admin/ (Claude Code usage report) → AdminAccountUsage
```

### Key modules

- **`src/client.ts`** — `ClaudeUsageClient` is the main public API. Orchestrates credential reading, OAuth authentication, token lifecycle, usage fetching, and account management.
- **`src/auth/`** — Authorizes by spawning `claude setup-token`, which opens the browser and prints a long-lived `sk-ant-...` token to stdout. `authorize()` captures that token and returns a `ClaudeCredentials` JSON string with a ~1-year expiry. Also exports `OAUTH_CLIENT_ID` and `OAUTH_TOKEN_URL` (used by `tokens/`).
- **`src/credentials/`** — Platform-specific credential readers (macOS Keychain, Linux secret-tool/file, Windows DPAPI/file). Factory via `createCredentialReader(platform)`. All implement the `CredentialReader` interface from `types.ts`.
- **`src/storage/`** — `AccountStore` persists accounts to an AES-256-GCM encrypted file (default `~/.claude-usage/accounts.enc`). Key is derived from machine ID via PBKDF2. `crypto.ts` handles encrypt/decrypt.
- **`src/tokens/`** — `validateToken()` checks expiry from credentials JSON. `refreshToken()` calls the Anthropic OAuth token endpoint. Uses `OAUTH_CLIENT_ID` and `OAUTH_TOKEN_URL` from `auth/`.
- **`src/usage/`** — `fetchUsage()` hits the Anthropic OAuth usage API. `fetchProfile()` hits the profile API to get account email. `transformUsageData()` converts the raw API response into the `OAuthAccountUsage` shape.
- **`src/admin/`** — Admin API key support. `fetchClaudeCodeUsage()` calls the Admin API's Claude Code usage report endpoint (with pagination). `transformClaudeCodeUsage()` aggregates daily entries into `AdminAccountUsage` with per-actor and per-model breakdowns.
- **`src/types.ts`** — All shared types. `AccountUsage` is a discriminated union of `OAuthAccountUsage | AdminAccountUsage`. `ClaudeCredentials`, `AdminCredentials`, and `SavedAccount`/`AccountsData` are internal; `AccountUsage`, `OAuthAccountUsage`, `AdminAccountUsage`, `ActorUsage`, `ModelUsageBreakdown`, `Account`, `AccountType`, `ClaudeUsageClientOptions`, `UsageWindow`, `ExtraUsage` are public exports.
- **`src/errors.ts`** — Error hierarchy: `ClaudeUsageError` → `AccountNotFoundError`, `StorageError`. Also exports `AuthenticationError` (used by both OAuth and admin modules).

### Conventions

- ESM-first (`"type": "module"` in package.json). Imports use `.js` extensions.
- Dual-format build output (ESM + CJS) via tsup.
- Tests use vitest with `globals: false` (explicit imports from `vitest`).
- Credentials are stored as raw JSON strings throughout the pipeline, parsed only when needed.
- Coverage is configured to exclude `scripts/`, `dist/`, and build configs.
