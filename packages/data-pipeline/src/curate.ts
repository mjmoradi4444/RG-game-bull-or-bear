import type { Candle, RawClip, StoredPuzzle } from './types';
import { PARAMS } from './config';
import { mulberry32, round, shuffle, slug } from './util';

export interface CurateStats {
  totalRaw: number;
  afterDegenerateDrop: number;
  droppedDegenerate: number;
  afterRangingDrop: number;
  droppedRanging: number;
}

/**
 * Turn raw clips into the fair, varied, balanced dataset (SPEC §3.4):
 *  - drop degenerate clips (|move| < ATR_K × ATR — too flat to call cleanly),
 *  - drop ranging clips (context efficiency ratio < ER_MIN_TREND — no readable
 *    trend, so a call is luck not skill),
 *  - balance ~50/50 up/down PER ASSET (so a coin-flipper averages 50%, any higher
 *    is provably skill, and no directional bias is exploitable),
 *  - cap per asset (keep the mix varied, not crypto-heavy),
 *  - shuffle deterministically (seeded).
 */
export function curate(
  allClips: RawClip[],
  precision: Record<string, number>,
): { puzzles: StoredPuzzle[]; stats: CurateStats } {
  const rnd = mulberry32(0xb011bea2);

  const notDegenerate = allClips.filter((c) => c.atr > 0 && c.absMove >= PARAMS.ATR_K * c.atr);
  const filtered = notDegenerate.filter((c) => c.er >= PARAMS.ER_MIN_TREND);

  // Group by asset × difficulty so we can balance 50/50 WITHIN each level — that way
  // every difficulty is directionally unbiased per asset (no "always follow the
  // trend on Easy" exploit), not just the dataset as a whole.
  const groups = new Map<string, RawClip[]>();
  for (const c of filtered) {
    const key = `${c.asset}|${difficulty(c)}`;
    const arr = groups.get(key);
    if (arr) arr.push(c);
    else groups.set(key, [c]);
  }

  const kept: RawClip[] = [];
  for (const clips of groups.values()) {
    const ups = shuffle(
      clips.filter((c) => c.outcome === 'up'),
      rnd,
    );
    const downs = shuffle(
      clips.filter((c) => c.outcome === 'down'),
      rnd,
    );
    const perSide = Math.min(ups.length, downs.length, Math.floor(PARAMS.PER_GROUP_CAP / 2));
    for (let i = 0; i < perSide; i++) {
      kept.push(ups[i]!, downs[i]!);
    }
  }

  const puzzles = shuffle(kept, rnd).map((c) => toStored(c, precision[c.asset] ?? 2));

  return {
    puzzles,
    stats: {
      totalRaw: allClips.length,
      afterDegenerateDrop: notDegenerate.length,
      droppedDegenerate: allClips.length - notDegenerate.length,
      afterRangingDrop: filtered.length,
      droppedRanging: notDegenerate.length - filtered.length,
    },
  };
}

/** Grade by trend clarity: a clean, strong trend is easy to read; a faint one hard. */
function difficulty(c: RawClip): 'easy' | 'med' | 'hard' {
  if (c.er >= PARAMS.ER_EASY) return 'easy';
  if (c.er >= PARAMS.ER_MED) return 'med';
  return 'hard';
}

function toStored(c: RawClip, precision: number): StoredPuzzle {
  const enc = (cd: Candle): number[] => [
    round(cd.o, precision),
    round(cd.h, precision),
    round(cd.l, precision),
    round(cd.c, precision),
  ];
  return {
    id: `${slug(c.asset)}-${c.timeframe}-${c.freezeT}`,
    asset: c.asset,
    tf: c.timeframe,
    c: c.context.map(enc),
    f: c.future.map(enc),
    o: c.outcome,
    d: difficulty(c),
    v: { t: new Date(c.freezeT).toISOString(), s: c.source },
  };
}
