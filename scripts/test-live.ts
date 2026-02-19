#!/usr/bin/env npx tsx
// scripts/test-live.ts — Live test for claude-usage-core
//
// Usage:
//   npx tsx scripts/test-live.ts              # show usage for all saved accounts
//   npx tsx scripts/test-live.ts auth <name>  # authenticate via browser and save as <name>
//   npx tsx scripts/test-live.ts save <name>  # save current keychain credentials as <name>
import { ClaudeUsageClient } from '../src/index.js';
import type { AccountUsage, UsageWindow } from '../src/index.js';

const client = new ClaudeUsageClient();

function formatPercent(n: number): string {
  return `${Math.round(n)}%`;
}

function formatResetTime(d: Date | null): string {
  if (!d) return '—';
  const now = Date.now();
  const diff = d.getTime() - now;
  if (diff <= 0) return 'now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function fmtWindow(w: UsageWindow | null): string {
  if (!w) return '—';
  return `${formatPercent(w.percent)} (resets ${formatResetTime(w.resetsAt)})`;
}

function printUsageTable(usages: AccountUsage[]) {
  console.log();
  const header = ['Account', 'Email', 'Session', 'Weekly', 'Opus', 'Sonnet', 'Extra', 'Error'];
  const rows = usages.map(u => [
    u.accountName,
    u.email ?? '—',
    fmtWindow(u.session),
    fmtWindow(u.weekly),
    fmtWindow(u.opus),
    fmtWindow(u.sonnet),
    u.extraUsage.isEnabled
      ? `${u.extraUsage.utilization != null ? formatPercent(u.extraUsage.utilization) : '—'} ($${u.extraUsage.usedCredits ?? 0}/${u.extraUsage.monthlyLimit ?? '∞'})`
      : 'off',
    u.error ?? '',
  ]);

  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map(r => r[i].length))
  );

  const sep = widths.map(w => '─'.repeat(w + 2)).join('┼');
  const pad = (s: string, w: number) => s + ' '.repeat(w - s.length);

  console.log(header.map((h, i) => ` ${pad(h, widths[i])} `).join('│'));
  console.log(sep);
  for (const row of rows) {
    console.log(row.map((c, i) => ` ${pad(c, widths[i])} `).join('│'));
  }
  console.log();
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  // Auth subcommand: open browser, authenticate, and save account
  if (command === 'auth') {
    const name = args[0];
    if (!name) {
      console.error('Usage: test-live.ts auth <account-name>');
      process.exit(1);
    }
    try {
      await client.authenticate(name);
      console.log(`Authenticated and saved account "${name}".`);
    } catch (err) {
      console.error(`Authentication failed for "${name}": ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  // Save subcommand: save current keychain creds under a name
  if (command === 'save') {
    const name = args[0];
    if (!name) {
      console.error('Usage: test-live.ts save <account-name>');
      process.exit(1);
    }
    try {
      await client.saveAccount(name);
      console.log(`Saved account "${name}" from OS keychain.`);
    } catch (err) {
      console.error(`Failed to save "${name}": ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  // Default: list accounts and fetch usage
  console.log('=== claude-usage-core live test ===\n');

  const accounts = await client.listAccounts();
  if (accounts.length === 0) {
    console.log('No saved accounts. Add one with:');
    console.log('  npx tsx scripts/test-live.ts save <name>');
    return;
  }

  console.log(`Saved accounts (${accounts.length}):`);
  for (const a of accounts) {
    const email = a.email ? ` <${a.email}>` : '';
    console.log(`  - ${a.name}${email}${a.isActive ? ' (active)' : ''} — saved ${a.savedAt.toLocaleDateString()}`);
  }

  console.log(`\nFetching usage...`);
  const usages = await client.getAllAccountsUsage();
  printUsageTable(usages);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
