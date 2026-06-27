import type { Candle, RawClip, StoredPuzzle } from './types';
import { PARAMS } from './config';
import { mulberry32, round, shuffle, slug } from './util';

export interface CurateStats {
  totalRaw: number;
  afterDegenerateDrop: number;
  droppedDegenerate: number;
}

/**
 * Turn raw clips into the fair, varied, balanced dataset (SPEC §3.4):
 *  - drop degenerate clips (|move| < ATR_K × ATR — too flat to call cleanly),
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

  const filtered = allClips.filter((c) => c.atr > 0 && c.absMove >= PARAMS.ATR_K * c.atr);

  const byAsset = new Map<string, RawClip[]>();
  for (const c of filtered) {
    const arr = byAsset.get(c.asset);
    if (arr) arr.push(c);
    else byAsset.set(c.asset, [c]);
  }

  const kept: RawClip[] = [];
  for (const clips of byAsset.values()) {
    const ups = shuffle(
      clips.filter((c) => c.outcome === 'up'),
      rnd,
    );
    const downs = shuffle(
      clips.filter((c) => c.outcome === 'down'),
      rnd,
    );
    const perSide = Math.min(ups.length, downs.length, Math.floor(PARAMS.PER_ASSET_CAP / 2));
    for (let i = 0; i < perSide; i++) {
      kept.push(ups[i]!, downs[i]!);
    }
  }

  const puzzles = shuffle(kept, rnd).map((c) => toStored(c, precision[c.asset] ?? 2));

  return {
    puzzles,
    stats: {
      totalRaw: allClips.length,
      afterDegenerateDrop: filtered.length,
      droppedDegenerate: allClips.length - filtered.length,
    },
  };
}

function difficulty(c: RawClip): 'easy' | 'med' | 'hard' {
  const ratio = c.atr > 0 ? c.absMove / c.atr : 0;
  if (ratio >= 2) return 'easy';
  if (ratio >= 1) return 'med';
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
