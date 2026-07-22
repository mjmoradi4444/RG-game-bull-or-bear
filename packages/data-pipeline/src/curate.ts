import type { Candle, RawClip, StoredPuzzle } from './types';
import { PARAMS, PER_GROUP_CAP, classOf } from './config';
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
  // Difficulty terciles PER ASSET so every asset splits ~evenly into easy/med/hard.
  // Global terciles would lump an asset into one tier whenever its ER band differs
  // from the pool's (forex 1h/15m trends cleaner than crypto 5m), leaving forex
  // unbalanced across tiers — §6.2 needs FOREX spread evenly across all three, so we
  // grade each asset against its OWN efficiency-ratio distribution.
  erThresholds.clear();
  const ersByAsset = new Map<string, number[]>();
  for (const c of filtered) {
    const arr = ersByAsset.get(c.asset);
    if (arr) arr.push(c.er);
    else ersByAsset.set(c.asset, [c.er]);
  }
  for (const [asset, ers] of ersByAsset) {
    ers.sort((a, b) => a - b);
    erThresholds.set(asset, {
      med: ers[Math.floor(ers.length / 3)] ?? PARAMS.ER_MED,
      easy: ers[Math.floor((2 * ers.length) / 3)] ?? PARAMS.ER_EASY,
    });
  }

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
    // Cap per (asset × difficulty) by the asset's CLASS, so the finished pool lands
    // on the §6.2 mix (forex-heavy) rather than the raw fetch's crypto-heavy balance.
    const cap = PER_GROUP_CAP[classOf(clips[0]!.asset)];
    const perSide = Math.min(ups.length, downs.length, Math.floor(cap / 2));
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

// Per-asset ER tercile thresholds, populated in curate() from each asset's own
// trending clips so every asset (especially FOREX) spreads ~evenly across the three
// tiers regardless of how its efficiency-ratio band compares to other assets'.
const erThresholds = new Map<string, { med: number; easy: number }>();

/** Grade by trend clarity (per-asset quantile terciles): clearest trend = easy,
 *  faintest = hard. Falls back to the fixed PARAMS thresholds for an ungraded asset. */
function difficulty(c: RawClip): 'easy' | 'med' | 'hard' {
  const t = erThresholds.get(c.asset);
  const easyQ = t?.easy ?? PARAMS.ER_EASY;
  const medQ = t?.med ?? PARAMS.ER_MED;
  if (c.er >= easyQ) return 'easy';
  if (c.er >= medQ) return 'med';
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
