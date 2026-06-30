export interface Candle {
  t: number; // ms UTC timestamp
  o: number;
  h: number;
  l: number;
  c: number;
}

export type Outcome = 'up' | 'down';
export type Timeframe = '5m' | '15m' | '1h';
export type Source = 'binance' | 'dukascopy';

/** A sliced clip with everything curation needs to judge it. */
export interface RawClip {
  asset: string;
  timeframe: Timeframe;
  source: Source;
  context: Candle[]; // length PARAMS.CONTEXT (last one is the freeze candle)
  future: Candle[]; // length PARAMS.HORIZON
  freezeT: number;
  freezeClose: number;
  outcome: Outcome;
  deltaPct: number; // signed % move freeze→horizon
  absMove: number; // |close[freeze+H] - freezeClose|
  atr: number; // context average true range
  er: number; // context efficiency ratio (0=ranging, 1=clean trend)
}

/**
 * Compact stored shape written to puzzles.json — candles are [o,h,l,c] tuples
 * (no keys) to keep the bundle small. The game decodes these to its Puzzle type.
 * freezeClose is derived (last context close), so it isn't stored.
 */
export interface StoredPuzzle {
  id: string;
  asset: string;
  tf: Timeframe;
  c: number[][]; // context candles [o,h,l,c]
  f: number[][]; // future candles [o,h,l,c]
  o: Outcome;
  d: 'easy' | 'med' | 'hard';
  v: { t: string; s: Source }; // verify: real UTC date, source
}
