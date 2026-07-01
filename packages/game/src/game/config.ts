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
  /** Playback duration for streaming the context candles in. */
  PLAYBACK_MS: 4000,
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
