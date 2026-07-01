import type { Puzzle } from './Puzzle';

/**
 * A short, honest price-action read of why a puzzle resolved the way it did, used to
 * teach on the reveal (the player asked "tell me why my call was right/wrong"). It is
 * a heuristic over the REAL candles — trend direction/structure, momentum into the
 * freeze, proximity to the context high/low (support/resistance), pullbacks, and
 * range breaks — phrased in standard price-action terms across several patterns so
 * the teaching varies. It explains; it never claims to predict (SPEC §9).
 */
export interface PaPattern {
  /** Stable key for balancing pattern variety across a match. */
  key: string;
  /** Short pattern name shown on the reveal. */
  pattern: string;
  /** One-line reason grounded in the visible structure. */
  why: string;
}

export function analyzePattern(p: Puzzle): PaPattern {
  const ctx = p.candles;
  const fut = p.future;
  const closes = ctx.map((c) => c.c);
  const n = closes.length;
  const first = closes[0]!;
  const last = closes[n - 1]!;
  const trendUp = last >= first;
  const outUp = p.outcome === 'up';
  const continued = trendUp === outUp;

  const ctxHi = Math.max(...ctx.map((c) => c.h));
  const ctxLo = Math.min(...ctx.map((c) => c.l));
  const span = ctxHi - ctxLo || 1;
  const fz = p.freezeClose;
  const nearHi = (ctxHi - fz) / span <= 0.22;
  const nearLo = (fz - ctxLo) / span <= 0.22;

  const futClose = fut.length ? fut[fut.length - 1]!.c : fz;
  const t = trendUp ? 'up' : 'down';
  const struct = trendUp ? 'higher highs and higher lows' : 'lower highs and lower lows';

  // Pullback: over the last few context candles price moved AGAINST the trend.
  const k = Math.min(4, n - 1);
  const recent = last - closes[n - 1 - k]!;
  const pullback = trendUp ? recent < 0 : recent > 0;

  if (continued) {
    if (outUp && futClose > ctxHi) {
      return {
        key: 'breakout',
        pattern: 'Breakout',
        why: `${p.asset} pressed against resistance at the prior high, then broke out — price closed above the range and ran up.`,
      };
    }
    if (!outUp && futClose < ctxLo) {
      return {
        key: 'breakdown',
        pattern: 'Breakdown',
        why: `${p.asset} cracked support at the prior low — the range broke and price accelerated lower.`,
      };
    }
    if (pullback) {
      return {
        key: 'pullback',
        pattern: 'Pullback continuation',
        why: `Inside a clear ${t}-trend, price made a small pullback into the freeze before the trend resumed ${t}.`,
      };
    }
    return {
      key: 'continuation',
      pattern: 'Trend continuation',
      why: `${p.asset} was trending ${t} — ${struct} — and momentum carried it ${t}.`,
    };
  }

  // Reversal family (outcome opposed the prior trend).
  if (trendUp && nearHi) {
    return {
      key: 'rejection',
      pattern: 'Resistance rejection',
      why: `Price pushed into resistance at the prior high, buyers dried up, and it rejected lower.`,
    };
  }
  if (!trendUp && nearLo) {
    return {
      key: 'bounce',
      pattern: 'Support bounce',
      why: `Price tested support at the prior low, sellers gave up, and it bounced higher.`,
    };
  }
  const fromT = trendUp ? 'up' : 'down';
  const toT = outUp ? 'up' : 'down';
  return {
    key: 'reversal',
    pattern: 'Reversal',
    why: `The ${fromT}-move over-extended and momentum faded — it rolled over and reversed ${toT}.`,
  };
}

/** Convenience for the reveal view (name + reason). */
export function explainOutcome(p: Puzzle): { pattern: string; why: string } {
  const a = analyzePattern(p);
  return { pattern: a.pattern, why: a.why };
}

/** Pattern key only — used to spread pattern variety across a match. */
export function patternKey(p: Puzzle): string {
  return analyzePattern(p).key;
}
