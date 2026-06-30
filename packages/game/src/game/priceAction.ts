import type { Puzzle } from './Puzzle';

/**
 * A short, honest price-action read of why a puzzle resolved the way it did, used to
 * teach on the reveal (the player asked "tell me why my call was right/wrong"). It is
 * a heuristic over the REAL candles — trend direction, momentum into the freeze, and
 * proximity to the context high/low (support/resistance) — phrased in standard
 * price-action terms. It explains, it never claims to predict (SPEC §9).
 */
export interface PaExplain {
  /** Short pattern name, e.g. "Trend continuation". */
  pattern: string;
  /** One- or two-sentence reason grounded in the visible structure. */
  why: string;
}

export function explainOutcome(p: Puzzle): PaExplain {
  const closes = p.candles.map((c) => c.c);
  const n = closes.length;
  const first = closes[0]!;
  const last = closes[n - 1]!;
  const trendUp = last >= first;
  const outUp = p.outcome === 'up';
  const continued = trendUp === outUp;

  // Momentum over the last stretch into the freeze.
  const k = Math.min(6, n - 1);
  const momUp = last - closes[n - 1 - k]! >= 0;

  // Context extremes → was the freeze pressing into resistance / support?
  const hi = Math.max(...p.candles.map((c) => c.h));
  const lo = Math.min(...p.candles.map((c) => c.l));
  const span = hi - lo || 1;
  const fz = p.freezeClose;
  const nearHi = (hi - fz) / span <= 0.2;
  const nearLo = (fz - lo) / span <= 0.2;

  if (continued) {
    const t = trendUp ? 'up' : 'down';
    const struct = trendUp ? 'higher highs and higher lows' : 'lower highs and lower lows';
    const momNote = momUp === trendUp ? 'momentum stayed with it' : 'momentum held';
    return {
      pattern: 'Trend continuation',
      why: `${p.asset} was trending ${t} — ${struct} — and ${momNote} into the freeze, so price kept going ${t}.`,
    };
  }

  const fromT = trendUp ? 'up' : 'down';
  const toT = outUp ? 'up' : 'down';
  const zone = trendUp
    ? nearHi
      ? 'resistance at the prior high'
      : 'an over-extended high'
    : nearLo
      ? 'support at the prior low'
      : 'an over-extended low';
  return {
    pattern: 'Reversal',
    why: `Price had pushed ${fromT} into ${zone} and momentum was fading — it rolled over and reversed ${toT}.`,
  };
}
