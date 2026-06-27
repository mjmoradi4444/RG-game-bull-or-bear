import type { Timeframe } from './types';

/** Slicing + curation params. CONTEXT/HORIZON mirror the game's config.ts. */
export const PARAMS = {
  CONTEXT: 30,
  HORIZON: 10,
  /** Candles between clip starts. = CONTEXT → each clip's context window is fresh. */
  STRIDE: 30,
  /** Degenerate filter: keep a clip only if |move| ≥ ATR_K × context ATR. */
  ATR_K: 0.6,
  /** Max balanced clips kept per asset (keeps the mix varied, not crypto-heavy). */
  PER_ASSET_CAP: 110,
  TARGET_MIN: 500,
} as const;

export interface AssetSpec {
  asset: string; // display name, e.g. 'XAU/USD'
  source: 'binance' | 'dukascopy';
  symbol: string; // binance pair or dukascopy instrument id
  timeframes: Timeframe[];
  pricePrecision: number;
}

/**
 * The asset roster. XAU/USD and EUR/USD are required (brand non-negotiable).
 * Crypto comes from Binance (deep, fast REST); FX/Gold/Oil from Dukascopy (keyless).
 */
export const ASSETS: AssetSpec[] = [
  { asset: 'BTC', source: 'binance', symbol: 'BTCUSDT', timeframes: ['5m', '15m', '1h'], pricePrecision: 1 },
  { asset: 'ETH', source: 'binance', symbol: 'ETHUSDT', timeframes: ['5m', '15m', '1h'], pricePrecision: 2 },
  { asset: 'SOL', source: 'binance', symbol: 'SOLUSDT', timeframes: ['15m', '1h'], pricePrecision: 3 },
  { asset: 'XAU/USD', source: 'dukascopy', symbol: 'xauusd', timeframes: ['1h'], pricePrecision: 2 },
  { asset: 'EUR/USD', source: 'dukascopy', symbol: 'eurusd', timeframes: ['1h'], pricePrecision: 5 },
  { asset: 'GBP/USD', source: 'dukascopy', symbol: 'gbpusd', timeframes: ['1h'], pricePrecision: 5 },
  { asset: 'USD/JPY', source: 'dukascopy', symbol: 'usdjpy', timeframes: ['1h'], pricePrecision: 3 },
  { asset: 'WTI', source: 'dukascopy', symbol: 'lightcmdusd', timeframes: ['1h'], pricePrecision: 2 },
];

/** Binance candles to pull per (symbol, timeframe). */
export const BINANCE_CANDLES = 4000;

/** Dukascopy history window (real past data; today is ~2026-06). ~5 months gives the
 *  FX/Gold/Oil assets enough clips to clear the dataset target with margin and adds
 *  regime variety (trending vs ranging). Fetched in 14-day chunks, in parallel
 *  across assets (see dukascopy.ts + build.ts), since a single long pull fails and a
 *  sequential 5-asset pull is slow. */
export const DUKA_FROM = '2026-01-01';
export const DUKA_TO = '2026-05-31';

/** Concurrent series fetches. Crypto is cached/instant; this bounds how many slow
 *  Dukascopy tick downloads run at once — enough to cut wall-time, low enough not to
 *  trip the connection resets that chunking already guards against. */
export const FETCH_CONCURRENCY = 3;
