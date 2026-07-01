import puzzlesData from '../data/puzzles.json';
import type { Rng } from '../engine/Rng';
import type { Candle, Outcome, Puzzle, Source, Timeframe } from './Puzzle';
import { patternKey } from './priceAction';

/**
 * The compact on-disk shape emitted by data-pipeline (numeric tuples, no keys, to
 * keep the bundle small). Decoded once at boot into the runtime Puzzle type.
 */
interface StoredPuzzle {
  id: string;
  asset: string;
  tf: Timeframe;
  c: number[][]; // context candles [o,h,l,c]
  f: number[][]; // future candles [o,h,l,c]
  o: Outcome;
  d: 'easy' | 'med' | 'hard';
  v: { t: string; s: Source }; // verify: real UTC date, source
}

function toCandle(a: number[]): Candle {
  return { o: a[0]!, h: a[1]!, l: a[2]!, c: a[3]! };
}

function decode(s: StoredPuzzle): Puzzle {
  const candles = s.c.map(toCandle);
  return {
    id: s.id,
    asset: s.asset,
    timeframe: s.tf,
    candles,
    future: s.f.map(toCandle),
    freezeClose: candles[candles.length - 1]!.c,
    outcome: s.o,
    difficulty: s.d,
    verify: { realDateUtc: s.v.t, source: s.v.s },
  };
}

/**
 * Holds the decoded puzzle dataset and hands out balanced, varied selections.
 * Selection takes an Rng so it can be deterministic from a match seed (Phase 5);
 * solo play just passes the time-seeded engine Rng.
 */
export class PuzzleBank {
  private readonly all: Puzzle[];

  constructor() {
    this.all = (puzzlesData as unknown as StoredPuzzle[]).map(decode);
  }

  get size(): number {
    return this.all.length;
  }

  /**
   * Pick `n` puzzles, spreading them across price-action PATTERNS first (so the
   * teaching varies round to round, not all "trend continuation"), then distinct
   * assets, then filling the remainder. Deterministic for a given seeded Rng. An
   * optional difficulty restricts the pool to one level's tier (each tier is itself
   * 50/50, so the match stays fair).
   */
  pick(n: number, rng: Rng, difficulty?: 'easy' | 'med' | 'hard'): Puzzle[] {
    const base = difficulty ? this.all.filter((p) => p.difficulty === difficulty) : this.all;
    const pool = (base.length >= n ? base : this.all).slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }

    const chosen: Puzzle[] = [];
    const usedPatterns = new Set<string>();
    const usedAssets = new Set<string>();
    // 1) one of each distinct pattern (the fix for pattern imbalance)
    for (const p of pool) {
      if (chosen.length >= n) break;
      const key = patternKey(p);
      if (usedPatterns.has(key)) continue;
      chosen.push(p);
      usedPatterns.add(key);
      usedAssets.add(p.asset);
    }
    // 2) then broaden asset variety
    for (const p of pool) {
      if (chosen.length >= n) break;
      if (chosen.includes(p) || usedAssets.has(p.asset)) continue;
      chosen.push(p);
      usedAssets.add(p.asset);
    }
    // 3) fill any remaining
    for (const p of pool) {
      if (chosen.length >= n) break;
      if (!chosen.includes(p)) chosen.push(p);
    }
    return chosen.slice(0, n);
  }
}
