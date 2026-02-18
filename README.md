# claude-usage-core

Node.js TypeScript library for monitoring [Claude Code](https://claude.ai/code) usage across multiple accounts.

## Install

```bash
npm install claude-usage-core
```

## Usage

```ts
import { ClaudeUsageClient } from 'claude-usage-core';

const client = new ClaudeUsageClient();

// Save accounts
await client.saveAccount('Work');    // reads from OS keychain
await client.saveAccount('Personal', rawCredentialsJson);

// Fetch all accounts simultaneously
const usage = await client.getAllAccountsUsage();
// [
//   { accountName: 'Work', session: { percent: 0.45, resetsAt: Date }, weekly: {...}, opus: null },
//   { accountName: 'Personal', session: {...}, weekly: {...}, opus: {...} },
// ]

// Fetch single account
const workUsage = await client.getAccountUsage('Work');

// Switch active account
await client.switchAccount('Personal');

// List accounts
const accounts = await client.listAccounts();
```

## Options

```ts
new ClaudeUsageClient({
  storagePath?: string;  // default: ~/.claude-usage/accounts.enc
  betaVersion?: string;  // default: 'oauth-2025-04-20'
  platform?: 'auto' | 'macos' | 'linux' | 'windows';  // default: 'auto'
})
```

## Platform support

| Platform | Credential source |
|----------|------------------|
| macOS | macOS Keychain (`Claude Code-credentials`) |
| Linux | `~/.claude/.credentials.json` then `secret-tool` |
| Windows | `%APPDATA%\Claude\.credentials.json` then PowerShell |

Account data is stored encrypted (AES-256-GCM) using a machine-derived key.

## License

MIT
