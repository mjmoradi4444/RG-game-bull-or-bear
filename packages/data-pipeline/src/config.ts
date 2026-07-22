import type { Timeframe } from './types';

/** Asset classes for the forex-first weighting (mirrors game/config.ts). XAU/USD
 *  counts as FOREX (the brand's flagship chart); WTI is the lone commodity. */
export type AssetClass = 'forex' | 'commodity' | 'crypto';

/** Slicing + curation params. CONTEXT/HORIZON mirror the game's config.ts. */
export const PARAMS = {
  /** Real candles stored per clip. 100 so the player can zoom out / pan back and see
   *  genuine history (the default view shows only the recent ~25). */
  CONTEXT: 100,
  HORIZON: 10,
  /** Candles between clip starts. Large enough that 100-candle windows don't overlap
   *  into near-duplicates. Kept at 60 through the §6.2 rebuild — the extra FOREX
   *  volume comes from more timeframes + a wider window (real, distinct clips), never
   *  from a shorter stride (which would manufacture near-duplicates). */
  STRIDE: 60,
  /** Recent window (candles before the freeze) used for the trend/ranging judgment,
   *  independent of how much history we STORE — keeps difficulty about the setup
   *  leading into the decision, not the whole 100-candle backdrop. */
  ER_WINDOW: 30,
  /** Degenerate filter: keep a clip only if |move| ≥ ATR_K × context ATR. */
  ATR_K: 0.6,
  /** Ranging filter: drop clips whose context efficiency ratio is below this — no
   *  readable trend means a call is luck, not skill (SPEC §3.3/§3.4). Calibrated to
   *  the real ER distribution (intraday is noisy; median ER ≈ 0.17), this drops the
   *  choppiest ~half. */
  ER_MIN_TREND: 0.11,
  /** Fallback difficulty thresholds (efficiency ratio). The real terciles are
   *  computed PER ASSET in curate() so every asset splits ~evenly across the three
   *  tiers; these only apply if an asset yields too few clips to quantile. */
  ER_EASY: 0.36,
  ER_MED: 0.25,
  /** Sanity floor for the finished pool (§6.2 targets ~500). Only drives a console
   *  note; curation never pads to reach it. */
  TARGET_MIN: 480,
} as const;

/**
 * Max balanced clips kept per (asset × difficulty), BY ASSET CLASS. Sized to the
 * PRD-ONBOARDING-TASKS §6.2 target mix on a full network fetch:
 *   forex     28 → 4 assets × 3 tiers × 28 = 336  (≥ 320, balanced across tiers)
 *   commodity 26 → WTI       3 tiers × 26  =  78  (~75)
 *   crypto    18 → BTC+ETH   6 groups × 18 = 108  (~105)
 * Total ≈ 522 clips. Each group keeps an equal count of up/down (2 × perSide), so
 * the exactly-50/50 outcome invariant holds regardless of the cap. Caps are ceilings:
 * a group with fewer balanced clips than its cap simply contributes what it has.
 */
export const PER_GROUP_CAP: Record<AssetClass, number> = {
  forex: 28,
  commodity: 26,
  crypto: 18,
};

export interface AssetSpec {
  asset: string; // display name, e.g. 'XAU/USD'
  class: AssetClass; // forex-weighting bucket (drives PER_GROUP_CAP)
  source: 'binance' | 'dukascopy';
  symbol: string; // binance pair or dukascopy instrument id
  timeframes: Timeframe[];
  pricePrecision: number;
}

/**
 * The asset roster (PRD-ONBOARDING-TASKS §6.2 rebuild). XAU/USD and EUR/USD are
 * required (brand non-negotiable). Crypto comes from Binance (deep, fast REST);
 * FX/Gold/Oil from Dukascopy (keyless). SOL is removed entirely — it isn't in the
 * game's declared ASSETS list and the pool must stop leaning crypto.
 *
 * FOREX (+ WTI) now pull BOTH 15m and 1h: 1h alone over the old 5-month window
 * yielded only ~40 clips/asset (the crypto-heavy 66-forex pool). 15m quadruples the
 * candle count, and the wider DUKA window (below) roughly doubles it again, so every
 * (forex asset × tier) group fills its cap of 28 with real, distinct clips.
 */
export const ASSETS: AssetSpec[] = [
  { asset: 'BTC', class: 'crypto', source: 'binance', symbol: 'BTCUSDT', timeframes: ['5m', '15m', '1h'], pricePrecision: 1 },
  { asset: 'ETH', class: 'crypto', source: 'binance', symbol: 'ETHUSDT', timeframes: ['5m', '15m', '1h'], pricePrecision: 2 },
  { asset: 'XAU/USD', class: 'forex', source: 'dukascopy', symbol: 'xauusd', timeframes: ['15m', '1h'], pricePrecision: 2 },
  { asset: 'EUR/USD', class: 'forex', source: 'dukascopy', symbol: 'eurusd', timeframes: ['15m', '1h'], pricePrecision: 5 },
  { asset: 'GBP/USD', class: 'forex', source: 'dukascopy', symbol: 'gbpusd', timeframes: ['15m', '1h'], pricePrecision: 5 },
  { asset: 'USD/JPY', class: 'forex', source: 'dukascopy', symbol: 'usdjpy', timeframes: ['15m', '1h'], pricePrecision: 3 },
  { asset: 'WTI', class: 'commodity', source: 'dukascopy', symbol: 'lightcmdusd', timeframes: ['15m', '1h'], pricePrecision: 2 },
];

/** asset → class lookup for curation (which only sees RawClip.asset strings). */
const CLASS_BY_ASSET = new Map(ASSETS.map((a) => [a.asset, a.class] as const));
export function classOf(asset: string): AssetClass {
  return CLASS_BY_ASSET.get(asset) ?? 'crypto';
}

/** Binance candles to pull per (symbol, timeframe). */
export const BINANCE_CANDLES = 12000;

/** Dukascopy history window (real past data; today is ~2026-07). ~12 months, paired
 *  with the 15m timeframe, gives the FX/Gold/Oil assets enough clips to fill their
 *  §6.2 caps (forex ≥ 320) with margin and adds regime variety (trending vs ranging).
 *  Fetched in 14-day chunks, in parallel across assets (see dukascopy.ts + build.ts),
 *  since a single long pull fails and a sequential pull is slow. */
export const DUKA_FROM = '2025-07-01';
export const DUKA_TO = '2026-07-01';

/** Concurrent series fetches. Crypto is cached/instant; this bounds how many slow
 *  Dukascopy tick downloads run at once — enough to cut wall-time, low enough not to
 *  trip the connection resets that chunking already guards against. */
export const FETCH_CONCURRENCY = 3;
