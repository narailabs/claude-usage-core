# claude-usage-core

Node.js TypeScript library for monitoring [Claude Code](https://claude.ai/code) usage across multiple accounts. Supports OAuth-based Claude Code subscription accounts and Anthropic admin API key accounts.

## Install

```bash
npm install claude-usage-core
```

## Quick start

```ts
import { ClaudeUsageClient } from 'claude-usage-core';

const client = new ClaudeUsageClient();

// Save an account from OS keychain credentials
await client.saveAccount('Work');

// Or authenticate via OAuth browser flow
await client.authenticate('Personal');

// Or save an admin API key to see full usage across your org
await client.saveAdminAccount('Org', 'sk-ant-admin-...');

// Fetch usage for all accounts
const usage = await client.getAllAccountsUsage();
for (const u of usage) {
  if (u.accountType === 'oauth') {
    console.log(`${u.accountName}: ${u.session.percent * 100}% session used`);
  } else if (u.accountType === 'admin') {
    console.log(`${u.accountName}: ${u.inputTokens} tokens in, ${u.outputTokens} tokens out ($${(u.estimatedCostCents / 100).toFixed(2)})`);
  }
}
```

## API

### `new ClaudeUsageClient(options?)`

```ts
new ClaudeUsageClient({
  storagePath?: string;    // default: ~/.claude-usage/accounts.enc
  betaVersion?: string;    // default: 'oauth-2025-04-20'
  platform?: 'auto' | 'macos' | 'linux' | 'windows';  // default: 'auto'
})
```

### Account management

```ts
// Authenticate via OAuth browser flow (opens browser, exchanges code for tokens)
await client.authenticate('Work');

// Save account from raw credentials JSON (or reads from OS keychain if omitted)
await client.saveAccount('Work');
await client.saveAccount('Work', rawCredentialsJson);

// Save an admin API key — fetches Claude Code usage for all API keys/users in the org
await client.saveAdminAccount('Org', 'sk-ant-admin-...');

// List all saved accounts
const accounts = await client.listAccounts();
// [{ name: 'Work', email: 'you@company.com', accountType: 'oauth', isActive: true, savedAt: Date }]

// Switch active account
await client.switchAccount('Personal');

// Delete an account
await client.deleteAccount('Old');
```

### Usage fetching

```ts
// Fetch usage for all accounts in parallel
const allUsage = await client.getAllAccountsUsage();

// Fetch usage for a single account
const usage = await client.getAccountUsage('Work');
```

`AccountUsage` is a discriminated union — check `accountType` to determine the shape:

```ts
// OAuth accounts (accountType: 'oauth')
{
  accountType: 'oauth';
  accountName: string;
  email?: string;
  session: UsageWindow;       // 5-hour rolling window
  weekly: UsageWindow;        // 7-day rolling window
  opus: UsageWindow | null;   // Opus-specific 7-day window
  sonnet: UsageWindow | null; // Sonnet-specific 7-day window
  oauthApps: UsageWindow | null;
  cowork: UsageWindow | null;
  iguanaNecktie: UsageWindow | null;
  extraUsage: ExtraUsage;     // Extra usage / overuse billing info
  error?: string;
}

// Admin API key accounts (accountType: 'admin') — full Claude Code usage report
{
  accountType: 'admin';
  accountName: string;
  periodStart: Date;
  periodEnd: Date;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostCents: number;
  modelBreakdown: ModelUsageBreakdown[];  // Per-model token & cost totals
  actors: ActorUsage[];                   // Per-API-key / per-user breakdown
  error?: string;
}

// ActorUsage: { actorType: 'api_key' | 'user', actorName: string, inputTokens, outputTokens, ... }
// ModelUsageBreakdown: { model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, estimatedCostCents }
// UsageWindow: { percent: number, resetsAt: Date | null }
// ExtraUsage: { isEnabled: boolean, monthlyLimit: number | null, usedCredits: number | null, utilization: number | null }
```

### System credentials

```ts
// Read the OAuth access token from the OS keychain (without saving an account)
const token = await client.getSystemToken();
```

### Standalone OAuth

```ts
import { authorize } from 'claude-usage-core';

// Run the OAuth PKCE flow directly — returns a credentials JSON string
const credentials = await authorize({ timeoutMs: 120_000 });
```

### Error handling

```ts
import { AccountNotFoundError, StorageError, AuthenticationError, ClaudeUsageError } from 'claude-usage-core';

try {
  await client.getAccountUsage('Missing');
} catch (err) {
  if (err instanceof AccountNotFoundError) { /* ... */ }
  if (err instanceof StorageError) { /* ... */ }
  // Both extend ClaudeUsageError extends Error
}
```

## Token lifecycle

Tokens are managed automatically for OAuth accounts:

- **Expired tokens** are refreshed before fetching usage. If refresh fails, the error is returned in `AccountUsage.error`.
- **Near-expiry tokens** (< 5 min remaining) are proactively refreshed.
- **401 responses** trigger a single retry with a refreshed token.
- Refreshed credentials are persisted back to the encrypted store.

Admin API key accounts (`sk-ant-admin-...`) fetch the Claude Code usage report from the Anthropic Admin API, providing per-API-key and per-user token counts, model breakdowns, and estimated costs.

## Platform support

| Platform | Credential source |
|----------|------------------|
| macOS | macOS Keychain (`Claude Code-credentials`) |
| Linux | `~/.claude/.credentials.json` then `secret-tool` |
| Windows | `%APPDATA%\Claude\.credentials.json` then PowerShell |

Account data is stored encrypted (AES-256-GCM) using a machine-derived key.

## Live testing

The repo includes `scripts/test-live.ts`, a CLI tool that exercises the library against real Anthropic APIs. It serves as both a manual test harness and a working example of how to use the library.

```bash
# Add an OAuth account from your OS keychain (macOS/Linux)
npx tsx scripts/test-live.ts save Work

# Or authenticate via browser OAuth flow
npx tsx scripts/test-live.ts auth Personal

# Add an admin API key account (requires sk-ant-admin-... key)
npx tsx scripts/test-live.ts admin MyOrg sk-ant-admin-...

# Show usage for all saved accounts
npx tsx scripts/test-live.ts
```

Running without arguments lists all saved accounts and fetches usage for each. OAuth accounts show session/weekly usage windows, admin accounts show token counts, model breakdowns, and per-actor (API key / user) usage with estimated costs.

The script source (`scripts/test-live.ts`) demonstrates the full library API: creating a client, saving accounts, fetching usage, and working with the discriminated union response types.

## Development

```bash
npm run build       # Build ESM + CJS + .d.ts to dist/
npm test            # Run tests (vitest, single run)
npm run test:watch  # Run tests in watch mode
npm run typecheck   # Type-check with tsc --noEmit
```

Run a single test file:

```bash
npx vitest run tests/tokens/index.test.ts
```

## License

MIT
