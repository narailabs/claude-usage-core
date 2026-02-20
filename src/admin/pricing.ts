// src/admin/pricing.ts
// Model pricing in cents per million tokens.
// Source: https://platform.claude.com/docs/en/about-claude/pricing

interface ModelRates {
  input: number;    // cents per MTok (base input, uncached)
  output: number;   // cents per MTok
}

// Sorted longest-prefix-first so 'claude-opus-4-6' matches before 'claude-opus-4'.
const PRICING: [string, ModelRates][] = [
  // Opus 4.5+ ($5/$25)
  ['claude-opus-4-6', { input: 500, output: 2500 }],
  ['claude-opus-4-5', { input: 500, output: 2500 }],
  // Opus 4/4.1 ($15/$75)
  ['claude-opus-4-1', { input: 1500, output: 7500 }],
  ['claude-opus-4',   { input: 1500, output: 7500 }],
  // Sonnet ($3/$15 — same across 3.5–4.6)
  ['claude-sonnet-4', { input: 300, output: 1500 }],
  ['claude-sonnet-3', { input: 300, output: 1500 }],
  ['claude-3-5-sonnet', { input: 300, output: 1500 }],
  ['claude-3-sonnet', { input: 300, output: 1500 }],
  // Haiku 4.5 ($1/$5)
  ['claude-haiku-4', { input: 100, output: 500 }],
  // Haiku 3.5 ($0.80/$4)
  ['claude-haiku-3', { input: 80, output: 400 }],
  ['claude-3-5-haiku', { input: 80, output: 400 }],
  // Legacy
  ['claude-3-opus', { input: 1500, output: 7500 }],
  ['claude-3-haiku', { input: 25, output: 125 }],
];

// Cache pricing multipliers (relative to base input price)
const CACHE_5M_WRITE_MULTIPLIER = 1.25;
const CACHE_1H_WRITE_MULTIPLIER = 2.0;
const CACHE_READ_MULTIPLIER = 0.1;

function getRates(model: string): ModelRates | null {
  for (const [prefix, rates] of PRICING) {
    if (model.startsWith(prefix)) return rates;
  }
  return null;
}

/**
 * Estimates cost in cents for a single usage result (one model in one daily bucket).
 * Uses the raw token breakdown for accurate cache pricing.
 */
export function estimateCostCents(
  model: string,
  uncachedInput: number,
  cacheRead: number,
  cache5mWrite: number,
  cache1hWrite: number,
  output: number,
): number {
  const rates = getRates(model);
  if (!rates) return 0;

  const cost =
    uncachedInput * rates.input +
    cacheRead * rates.input * CACHE_READ_MULTIPLIER +
    cache5mWrite * rates.input * CACHE_5M_WRITE_MULTIPLIER +
    cache1hWrite * rates.input * CACHE_1H_WRITE_MULTIPLIER +
    output * rates.output;

  return cost / 1_000_000;
}
