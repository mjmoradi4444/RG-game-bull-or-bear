/**
 * Bull or Bear — all tunable gameplay constants in one place (SPEC §2).
 * Shared by the round engine, the match layer, and (the relevant subset) the
 * offline data-pipeline so curation thresholds stay in sync with play.
 */
export const CONFIG = {
  /** Real candles stored per clip. 100 so the player can zoom out / pan back into
   *  genuine history; the chart defaults to showing the most recent DEFAULT_VIEW. */
  CONTEXT_CANDLES: 100,
  /** Candles shown by default before the freeze (zoom-out/pan reveals the rest). */
  DEFAULT_VIEW: 25,
  /** Candles into the future the outcome is measured at (skill horizon, not next tick). */
  HORIZON_H: 10,
  /** Seconds on the decision timer once the chart freezes. 15s: real analysis
   *  (zoom/pan + reading structure) takes time; this isn't a reflex game. */
  DECISION_SECONDS: 15,
  /** Playback duration for streaming the context candles in. 13s (~70% slower than
   *  the original 4s): 100 candles at ~7.7/s reads like a live feed instead of a
   *  blur. Impatient players can tap to skip straight to the decision. */
  PLAYBACK_MS: 13000,
  /** Reveal duration for animating the real future candles. */
  REVEAL_MS: 3000,
  /** Rounds per match. 5 keeps a match short with 15s thinking time + a teaching
   *  reveal each round; leaderboard spread comes from difficulty-weighted scoring. */
  ROUNDS: 5,
  /** Sudden-death extra round on a tie. */
  TIEBREAKER: true,
} as const;

/** Assets in the dataset. XAU/USD and EUR/USD are required (brand non-negotiable). */
export const ASSETS = [
  'XAU/USD',
  'EUR/USD',
  'GBP/USD',
  'USD/JPY',
  'WTI',
  'BTC',
  'ETH',
] as const;

export type Asset = (typeof ASSETS)[number];

/**
 * Asset-class weighting (PRD-ONBOARDING-TASKS §6). RebateGain is a FOREX rebate
 * brand, so the puzzle mix should feel forex — not the crypto-heavy pool the raw
 * dataset ships with. The runtime picker draws each round's class from these
 * weights (Lever 1); a dataset rebuild (Lever 2) makes the effect complete.
 */
export type AssetClass = 'forex' | 'commodity' | 'crypto';

export const ASSET_CLASS_WEIGHTS: Record<AssetClass, number> = {
  forex: 0.7,
  commodity: 0.15,
  crypto: 0.15,
};

/** Fallback preference when a class/difficulty bucket is exhausted (forex first,
 *  crypto last — keeps a forex-brand feel even on the fallback path). */
export const CLASS_PREFERENCE: readonly AssetClass[] = ['forex', 'commodity', 'crypto'];

/** Map a raw asset symbol to its class. XAU/USD counts as FOREX (the flagship
 *  chart), per the config's own brand comment. Unknown symbols default to crypto. */
export function assetClass(asset: string): AssetClass {
  switch (asset) {
    case 'XAU/USD':
    case 'EUR/USD':
    case 'GBP/USD':
    case 'USD/JPY':
    case 'AUD/USD':
    case 'USD/CHF':
      return 'forex';
    case 'WTI':
    case 'BRENT':
      return 'commodity';
    default:
      return 'crypto';
  }
}

/** Brand non-negotiables: every match should contain one of these where possible. */
export const BRAND_ASSETS = ['XAU/USD', 'EUR/USD'] as const;

/** Assets filtered out of the pool at runtime. SOL is now physically absent from
 *  puzzles.json (dropped per PRD §2.1 / §6.2), so this is empty — kept as the guard
 *  point for any future asset we need to drop without a full data rebuild. */
export const DROPPED_ASSETS = new Set<string>([]);
