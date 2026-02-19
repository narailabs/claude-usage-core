#!/usr/bin/env npx tsx
// scripts/test-live.ts — Interactive live test for claude-usage-core
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ClaudeUsageClient } from '../src/index.js';
import type { AccountUsage } from '../src/index.js';

const rl = createInterface({ input: stdin, output: stdout });
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

function printUsageTable(usages: AccountUsage[]) {
  console.log();
  const header = ['Account', 'Session', 'Weekly', 'Opus', 'Error'];
  const rows = usages.map(u => [
    u.accountName,
    `${formatPercent(u.session.percent)} (resets ${formatResetTime(u.session.resetsAt)})`,
    `${formatPercent(u.weekly.percent)} (resets ${formatResetTime(u.weekly.resetsAt)})`,
    u.opus ? `${formatPercent(u.opus.percent)} (resets ${formatResetTime(u.opus.resetsAt)})` : '—',
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
  console.log('=== claude-usage-core live test ===\n');

  // 1. Show existing accounts
  const existing = await client.listAccounts();
  if (existing.length > 0) {
    console.log(`Found ${existing.length} saved account(s):`);
    for (const a of existing) {
      console.log(`  - ${a.name}${a.isActive ? ' (active)' : ''} — saved ${a.savedAt.toLocaleDateString()}`);
    }
    console.log();
  } else {
    console.log('No saved accounts yet.\n');
  }

  // 2. Add accounts loop
  console.log('Add accounts from your OS keychain.');
  console.log('Switch Claude Code to the desired account, then type a name below.');
  console.log('Press Enter with no name to stop adding.\n');

  while (true) {
    const name = (await rl.question('Account name (or Enter to skip): ')).trim();
    if (!name) break;

    try {
      await client.saveAccount(name);
      console.log(`  Saved "${name}".\n`);
    } catch (err) {
      console.error(`  Failed to save "${name}": ${(err as Error).message}\n`);
    }
  }

  // 3. Fetch and display usage
  const accounts = await client.listAccounts();
  if (accounts.length === 0) {
    console.log('No accounts to fetch usage for. Bye!');
    rl.close();
    return;
  }

  console.log(`\nFetching usage for ${accounts.length} account(s)...`);
  const usages = await client.getAllAccountsUsage();
  printUsageTable(usages);

  rl.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  rl.close();
  process.exit(1);
});
