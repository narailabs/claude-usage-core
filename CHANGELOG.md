# Changelog

## 1.2.1

- Fixed `refreshToken` to use OAuth browser flow directly instead of shelling out to `claude setup-token` (works in VS Code extension host)
- Added `requireLongLived` option to `authorize()` — throws instead of silently falling back to short-lived tokens
- `refreshToken` now requires the long-lived (~1 year) token and fails loudly if creation fails

## 1.2.0

- Added `renameAccount(oldName, newName)` to rename saved accounts (rejects duplicate names)
- Added `refreshToken(name)` to re-provision OAuth tokens via `claude setup-token` CLI
- Admin accounts are guarded from accidental token refresh

## 1.1.0

- Long-lived OAuth tokens (~1 year) via `/api/oauth/claude_cli/create_api_key`, matching `claude setup-token` behavior
- Extra usage helpers: `formatCredits`, `formatExtraUsageDisplay`, `isExtraUsageVisible`, `getExtraUtilizationPercent`
- Fixed extra usage values (monthly_limit, usedCredits) — convert cents to dollars in transform
- Cost report API: `fetchCostReport`, `transformCostReport` for admin billing data
- Added `actualCostCents` field to `AdminAccountUsage` for real billing cost

## 1.0.2

- Updated README with `@narai` scoped package name, install instructions, and import examples
- Added npm and GitHub links to README

## 1.0.0

- Renamed package to `@narai/claude-usage-core`
- Published to npm under the `@narai` scope

## 0.3.0

- Switched to messages usage API
- Added `UsageOptions` with optional `startingAt` parameter for `getAllAccountsUsage()`

## 0.2.0

- Added admin API key support for Claude Code usage reports
- Added `AdminAccountUsage` type with token counts, cost estimates, and billing period
- Added `saveAdminAccount()` and `deleteAccount()` methods

## 0.1.0

- Initial release
- OAuth authentication flow with browser-based login
- Encrypted account storage with AES-256-GCM and machine-derived key
- Cross-platform credential readers (macOS)
- Token validation and automatic refresh
- Usage API client with session, weekly, and per-model breakdowns
- `ClaudeUsageClient` public API with `authenticate()`, `listAccounts()`, `getAllAccountsUsage()`
