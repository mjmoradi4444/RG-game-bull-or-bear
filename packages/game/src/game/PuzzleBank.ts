import puzzlesData from '../data/puzzles.json';
import type { Rng } from '../engine/Rng';
import type { Candle, Outcome, Puzzle, Source, Timeframe } from './Puzzle';

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
   * Pick `n` puzzles, preferring distinct assets first (variety per SPEC §3.4),
   * then filling the remainder. Deterministic for a given seeded Rng.
   */
  pick(n: number, rng: Rng): Puzzle[] {
    const pool = this.all.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }

    const chosen: Puzzle[] = [];
    const usedAssets = new Set<string>();
    for (const p of pool) {
      if (chosen.length >= n) break;
      if (usedAssets.has(p.asset)) continue;
      chosen.push(p);
      usedAssets.add(p.asset);
    }
    for (const p of pool) {
      if (chosen.length >= n) break;
      if (!chosen.includes(p)) chosen.push(p);
    }
    return chosen.slice(0, n);
  }
}
