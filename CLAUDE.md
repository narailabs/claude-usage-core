# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Build:** `npm run build` (uses tsup, outputs ESM + CJS + .d.ts to `dist/`)
- **Test:** `npm test` (vitest, single run)
- **Test watch:** `npm run test:watch`
- **Single test:** `npx vitest run tests/tokens/index.test.ts`
- **Typecheck:** `npm run typecheck` (tsc --noEmit)

## Architecture

This is a Node.js TypeScript library for monitoring Claude Code usage across multiple accounts. It reads OAuth credentials from the OS keychain, stores them encrypted locally, and fetches usage data from the Anthropic API.

### Pipeline flow

```
OS Keychain/Credentials → credentials/ → client.ts → tokens/ (validate/refresh) → usage/ (fetch API) → AccountUsage
                                            ↕
                                     storage/ (encrypted account store)
```

### Key modules

- **`src/client.ts`** — `ClaudeUsageClient` is the main public API. Orchestrates credential reading, token lifecycle, usage fetching, and account management.
- **`src/credentials/`** — Platform-specific credential readers (macOS Keychain, Linux secret-tool/file, Windows DPAPI/file). Factory via `createCredentialReader(platform)`. All implement the `CredentialReader` interface from `types.ts`.
- **`src/storage/`** — `AccountStore` persists accounts to an AES-256-GCM encrypted file (default `~/.claude-usage/accounts.enc`). Key is derived from machine ID via PBKDF2. `crypto.ts` handles encrypt/decrypt.
- **`src/tokens/`** — `validateToken()` checks expiry from credentials JSON. `refreshToken()` calls the Anthropic OAuth token endpoint.
- **`src/usage/`** — `fetchUsage()` hits the Anthropic usage API. `transformUsageData()` converts the raw API response (five_hour, seven_day, seven_day_opus) into the public `AccountUsage` shape.
- **`src/types.ts`** — All shared types. `ClaudeCredentials` and `SavedAccount`/`AccountsData` are internal; `AccountUsage`, `Account`, `ClaudeUsageClientOptions` are public exports.
- **`src/errors.ts`** — Error hierarchy: `ClaudeUsageError` → `AccountNotFoundError`, `StorageError`.

### Conventions

- ESM-first (`"type": "module"` in package.json). Imports use `.js` extensions.
- Dual-format build output (ESM + CJS) via tsup.
- Tests use vitest with `globals: false` (explicit imports from `vitest`).
- Credentials are stored as raw JSON strings throughout the pipeline, parsed only when needed.
