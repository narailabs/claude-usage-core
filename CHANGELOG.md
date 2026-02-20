# Changelog

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
