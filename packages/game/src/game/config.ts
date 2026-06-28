/**
 * Bull or Bear — all tunable gameplay constants in one place (SPEC §2).
 * Shared by the round engine, the match layer, and (the relevant subset) the
 * offline data-pipeline so curation thresholds stay in sync with play.
 */
export const CONFIG = {
  /** Lead-up candles visible before the freeze (enough context to read trend). */
  CONTEXT_CANDLES: 30,
  /** Candles into the future the outcome is measured at (skill horizon, not next tick). */
  HORIZON_H: 10,
  /** Seconds on the decision timer once the chart freezes. */
  DECISION_SECONDS: 8,
  /** Playback duration for streaming the context candles in. */
  PLAYBACK_MS: 4000,
  /** Reveal duration for animating the real future candles. */
  REVEAL_MS: 3000,
  /** Rounds per match. 10 so a leaderboard score spreads out and feels earned. */
  ROUNDS: 10,
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
