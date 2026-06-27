/**
 * The puzzle is the atom of fairness: a real slice of a real asset's history.
 * The outcome is whatever truly happened — never synthesized, never fudged
 * (SPEC §3.1). The `verify` field carries the real date + source so every reveal
 * can prove it (§3.4); it is shown only AFTER the player has called.
 */

export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
}

export type Outcome = 'up' | 'down';
export type Timeframe = '5m' | '15m' | '1h';
export type Source = 'binance' | 'dukascopy' | 'forexite' | 'alphavantage';

export interface Verify {
  /** Real UTC timestamp of the freeze candle. Hidden during play, shown on reveal. */
  realDateUtc: string;
  source: Source;
}

export interface Puzzle {
  id: string;
  asset: string; // e.g. "XAU/USD"
  timeframe: Timeframe;
  candles: Candle[]; // context window (length CONFIG.CONTEXT_CANDLES)
  future: Candle[]; // revealed future (length CONFIG.HORIZON_H)
  freezeClose: number;
  outcome: Outcome;
  difficulty?: 'easy' | 'med' | 'hard';
  verify: Verify;
}
