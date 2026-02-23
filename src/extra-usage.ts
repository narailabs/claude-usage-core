import type { ExtraUsage } from './types.js';

/** Format a dollar amount: 5.2 → "$5.20" */
export function formatCredits(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** Format as "$5.20/$50.00", or '' if data is missing */
export function formatExtraUsageDisplay(extra: ExtraUsage): string {
  if (!extra.isEnabled || extra.usedCredits == null || extra.monthlyLimit == null) return '';
  return `${formatCredits(extra.usedCredits)}/${formatCredits(extra.monthlyLimit)}`;
}

/** Whether extra usage should be shown (force=true shows all enabled accounts) */
export function isExtraUsageVisible(extra: ExtraUsage, force = false): boolean {
  if (!extra.isEnabled) return false;
  if (force) return true;
  return extra.usedCredits != null && extra.usedCredits > 0;
}

/** Utilization as 0-100 integer, or 0 if unknown */
export function getExtraUtilizationPercent(extra: ExtraUsage): number {
  if (extra.utilization == null) return 0;
  return Math.round(extra.utilization * 100);
}
