#!/usr/bin/env npx tsx
// scripts/test-live.ts — Live test for claude-usage-core
//
// Usage:
//   npx tsx scripts/test-live.ts                     # show usage for all saved accounts
//   npx tsx scripts/test-live.ts auth <name>         # authenticate via browser and save as <name>
//   npx tsx scripts/test-live.ts save <name>         # save current keychain credentials as <name>
//   npx tsx scripts/test-live.ts admin <name> <key>  # save an admin API key (full usage report)
import { ClaudeUsageClient } from '../src/index.js';
import type { AccountUsage, OAuthAccountUsage, AdminAccountUsage, UsageWindow } from '../src/index.js';

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

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function printTable(header: string[], rows: string[][]) {
  if (rows.length === 0) return;
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

function printOAuthTable(usages: OAuthAccountUsage[]) {
  if (usages.length === 0) return;

  console.log('  OAuth Accounts');
  console.log('  ' + '─'.repeat(60));

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

  printTable(header, rows);
}

function printAdminTable(usages: AdminAccountUsage[]) {
  if (usages.length === 0) return;

  for (const u of usages) {
    console.log(`  Admin Account: ${u.accountName}`);
    if (u.error) {
      console.log(`    Error: ${u.error}`);
      console.log();
      continue;
    }

    const start = u.periodStart.toLocaleDateString();
    const end = u.periodEnd.toLocaleDateString();
    console.log(`  Period: ${start} – ${end}`);
    console.log('  ' + '─'.repeat(60));

    // Totals
    console.log(`  Totals: ${formatNumber(u.inputTokens)} tokens in, ${formatNumber(u.outputTokens)} tokens out, ${formatCost(u.estimatedCostCents)}`);
    if (u.cacheCreationTokens > 0 || u.cacheReadTokens > 0) {
      console.log(`  Cache: ${formatNumber(u.cacheCreationTokens)} creation, ${formatNumber(u.cacheReadTokens)} read`);
    }
    console.log();

    // Per-model breakdown
    if (u.modelBreakdown.length > 0) {
      console.log('  Model Breakdown');
      const mHeader = ['Model', 'Input', 'Output', 'Cost'];
      const mRows = u.modelBreakdown.map(m => [
        m.model,
        formatNumber(m.inputTokens),
        formatNumber(m.outputTokens),
        formatCost(m.estimatedCostCents),
      ]);
      printTable(mHeader, mRows);
    }

    // Per-actor breakdown
    if (u.actors.length > 0) {
      console.log('  Per-Actor Breakdown');
      const aHeader = ['Type', 'Name', 'Input', 'Output', 'Cost'];
      const aRows = u.actors.map(a => [
        a.actorType === 'api_key' ? 'API Key' : 'User',
        a.actorName,
        formatNumber(a.inputTokens),
        formatNumber(a.outputTokens),
        formatCost(a.estimatedCostCents),
      ]);
      printTable(aHeader, aRows);
    }
  }
}

function printUsageTables(usages: AccountUsage[]) {
  console.log();
  const oauth = usages.filter((u): u is OAuthAccountUsage => u.accountType === 'oauth');
  const admin = usages.filter((u): u is AdminAccountUsage => u.accountType === 'admin');
  printOAuthTable(oauth);
  printAdminTable(admin);
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

  // Admin subcommand: save an admin API key account (full usage report)
  if (command === 'admin') {
    const name = args[0];
    const key = args[1];
    if (!name || !key) {
      console.error('Usage: test-live.ts admin <account-name> <admin-api-key>');
      process.exit(1);
    }
    try {
      await client.saveAdminAccount(name, key);
      console.log(`Saved admin account "${name}".`);
    } catch (err) {
      console.error(`Failed to save admin account "${name}": ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  // Default: list accounts and fetch usage
  console.log('=== claude-usage-core live test ===\n');

  const accounts = await client.listAccounts();
  if (accounts.length === 0) {
    console.log('No saved accounts. Add one with:');
    console.log('  npx tsx scripts/test-live.ts save <name>          # OAuth from keychain');
    console.log('  npx tsx scripts/test-live.ts auth <name>          # OAuth via browser');
    console.log('  npx tsx scripts/test-live.ts admin <name> <key>   # Admin API key (full usage)');
    return;
  }

  console.log(`Saved accounts (${accounts.length}):`);
  for (const a of accounts) {
    const email = a.email ? ` <${a.email}>` : '';
    const typeLabel = a.accountType === 'admin' ? ' [admin]' : ' [oauth]';
    console.log(`  - ${a.name}${email}${typeLabel}${a.isActive ? ' (active)' : ''} — saved ${a.savedAt.toLocaleDateString()}`);
  }

  console.log(`\nFetching usage...`);
  const usages = await client.getAllAccountsUsage();
  printUsageTables(usages);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
