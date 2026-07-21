import type { Rng } from '../engine/Rng';
import type { Candle, Outcome, Puzzle, Source, Timeframe } from './Puzzle';
import { patternKey } from './priceAction';
import {
  ASSET_CLASS_WEIGHTS,
  BRAND_ASSETS,
  CLASS_PREFERENCE,
  DROPPED_ASSETS,
  assetClass,
  type AssetClass,
} from './config';

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
 *
 * The dataset (~350 KB gzipped) is loaded via dynamic import, so Vite splits it out
 * of the main bundle: the title paints from a small JS chunk while the data streams
 * in parallel (Telegram webviews open on 3G; SPEC §9 wants a fast first paint).
 * Callers gate on `isReady` / `ready` before `pick()`.
 */
export class PuzzleBank {
  private all: Puzzle[] = [];
  /** Resolves once the dataset chunk has arrived and decoded. */
  readonly ready: Promise<void>;
  isReady = false;

  constructor() {
    this.ready = import('../data/puzzles.json').then((m) => {
      this.all = (m.default as unknown as StoredPuzzle[]).map(decode);
      this.isReady = true;
    });
  }

  get size(): number {
    return this.all.length;
  }

  /**
   * Pick `n` puzzles for a match, weighted toward FOREX (PRD-ONBOARDING-TASKS §6).
   *
   * Each round slot draws an asset class from ASSET_CLASS_WEIGHTS (forex .70 /
   * commodity .15 / crypto .15), then a puzzle of that class — preferring an unused
   * asset, then an unused price-action pattern (so the teaching still varies). If a
   * class bucket is exhausted, we fall back through CLASS_PREFERENCE (forex first,
   * crypto last). A brand guarantee ensures ≥1 XAU/USD or EUR/USD clip where the
   * difficulty bucket allows.
   *
   * Fully deterministic for a given seeded Rng: two duel clients with the same seed
   * and level draw the identical sequence (the fairness invariant). SOL is dropped
   * at runtime (DROPPED_ASSETS) until the dataset rebuild.
   */
  pick(n: number, rng: Rng, difficulty?: 'easy' | 'med' | 'hard'): Puzzle[] {
    const usable = this.all.filter((p) => !DROPPED_ASSETS.has(p.asset));
    const tier = difficulty ? usable.filter((p) => p.difficulty === difficulty) : usable;
    const base = tier.length >= n ? tier : usable;

    // Partition into class buckets, each deterministically shuffled.
    const buckets: Record<AssetClass, Puzzle[]> = { forex: [], commodity: [], crypto: [] };
    for (const p of base) buckets[assetClass(p.asset)].push(p);
    for (const cls of CLASS_PREFERENCE) shuffle(buckets[cls], rng);

    const chosen: Puzzle[] = [];
    const usedAssets = new Set<string>();
    const usedPatterns = new Set<string>();

    /** Take the best puzzle from a class bucket (unused asset → unused pattern →
     *  any), or null if the bucket is empty. */
    const takeFrom = (cls: AssetClass): Puzzle | null => {
      const bucket = buckets[cls];
      if (bucket.length === 0) return null;
      let idx = bucket.findIndex((p) => !usedAssets.has(p.asset));
      if (idx < 0) idx = bucket.findIndex((p) => !usedPatterns.has(patternKey(p)));
      if (idx < 0) idx = 0;
      const [p] = bucket.splice(idx, 1);
      return p ?? null;
    };

    for (let slot = 0; slot < n; slot++) {
      const target = weightedClass(rng);
      // Fallback order: the drawn class first, then the preference order.
      const order = [target, ...CLASS_PREFERENCE.filter((c) => c !== target)];
      let picked: Puzzle | null = null;
      for (const cls of order) {
        picked = takeFrom(cls);
        if (picked) break;
      }
      if (!picked) break; // whole pool exhausted
      chosen.push(picked);
      usedAssets.add(picked.asset);
      usedPatterns.add(patternKey(picked));
    }

    ensureBrandClip(chosen, base, rng);
    return chosen.slice(0, n);
  }

  /** A single brand FOREX puzzle (EUR/USD or XAU/USD) at the given difficulty, for
   *  the guided tutorial round (PRD-ONBOARDING-TASKS §5.2 — "always forex"). */
  pickGuided(rng: Rng, difficulty: 'easy' | 'med' | 'hard' = 'easy'): Puzzle | null {
    const brand = (BRAND_ASSETS as readonly string[]);
    let pool = this.all.filter((p) => brand.includes(p.asset) && p.difficulty === difficulty);
    if (pool.length === 0) pool = this.all.filter((p) => brand.includes(p.asset));
    if (pool.length === 0) pool = this.all.filter((p) => assetClass(p.asset) === 'forex');
    if (pool.length === 0) return null;
    return pool[rng.int(0, pool.length - 1)] ?? null;
  }

  /** Dev-only: the RAW weighted class-draw distribution (before the per-match brand
   *  guarantee / exhaustion fallback), for the §6.4 ±5pp config check. */
  classHistogram(rng: Rng, iterations: number): Record<AssetClass, number> {
    const counts: Record<AssetClass, number> = { forex: 0, commodity: 0, crypto: 0 };
    for (let i = 0; i < iterations; i++) counts[weightedClass(rng)]++;
    return counts;
  }

  /** Dev-only: the ACTUAL class shares over many full matches (what players see). */
  roundClassShares(rng: Rng, matches: number, n: number, difficulty?: 'easy' | 'med' | 'hard'): Record<AssetClass, number> {
    const counts: Record<AssetClass, number> = { forex: 0, commodity: 0, crypto: 0 };
    for (let i = 0; i < matches; i++) for (const p of this.pick(n, rng, difficulty)) counts[assetClass(p.asset)]++;
    return counts;
  }
}

function shuffle<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

/** Weighted class draw from ASSET_CLASS_WEIGHTS using one rng draw. */
function weightedClass(rng: Rng): AssetClass {
  const total = CLASS_PREFERENCE.reduce((s, c) => s + ASSET_CLASS_WEIGHTS[c], 0);
  let r = rng.next() * total;
  for (const c of CLASS_PREFERENCE) {
    r -= ASSET_CLASS_WEIGHTS[c];
    if (r < 0) return c;
  }
  return 'forex';
}

/** Guarantee ≥1 brand clip (XAU/USD or EUR/USD) when the pool has one (§6.3). */
function ensureBrandClip(chosen: Puzzle[], pool: Puzzle[], rng: Rng): void {
  if (chosen.some((p) => (BRAND_ASSETS as readonly string[]).includes(p.asset))) return;
  const candidates = pool.filter(
    (p) => (BRAND_ASSETS as readonly string[]).includes(p.asset) && !chosen.includes(p),
  );
  if (candidates.length === 0) return;
  const brand = candidates[rng.int(0, candidates.length - 1)]!;
  // Prefer replacing a DUPLICATE non-forex slot (removing it also fixes a repeat),
  // else the lowest-preference class (crypto → commodity), else the last slot — so
  // injecting the brand clip never manufactures an unnecessary repeat.
  const count = (asset: string): number => chosen.filter((p) => p.asset === asset).length;
  let replaceAt = chosen.findIndex((p) => assetClass(p.asset) !== 'forex' && count(p.asset) > 1);
  if (replaceAt < 0) replaceAt = chosen.findIndex((p) => assetClass(p.asset) === 'crypto');
  if (replaceAt < 0) replaceAt = chosen.findIndex((p) => assetClass(p.asset) === 'commodity');
  if (replaceAt < 0) replaceAt = chosen.length - 1;
  if (replaceAt >= 0) chosen[replaceAt] = brand;
}
