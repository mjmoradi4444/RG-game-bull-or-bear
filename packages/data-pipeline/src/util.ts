import type { Candle } from './types';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function round(x: number, precision: number): number {
  return Number(x.toFixed(precision));
}

/** Average true range over a candle window (price units). */
export function computeATR(candles: Candle[]): number {
  let sum = 0;
  let n = 0;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]!;
    const cur = candles[i]!;
    const tr = Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c));
    sum += tr;
    n++;
  }
  return n ? sum / n : 0;
}

/**
 * Kaufman efficiency ratio over a candle window's closes: net displacement ÷ total
 * path length, in [0,1]. ~1 = a clean directional trend; ~0 = choppy / ranging. We
 * use it to drop ranging clips (unreadable → luck) and to grade difficulty by how
 * clear the trend is (SPEC §3.4 — test skill, not chance).
 */
export function efficiencyRatio(candles: Candle[]): number {
  if (candles.length < 2) return 0;
  let path = 0;
  for (let i = 1; i < candles.length; i++) path += Math.abs(candles[i]!.c - candles[i - 1]!.c);
  if (path === 0) return 0;
  const net = Math.abs(candles[candles.length - 1]!.c - candles[0]!.c);
  return net / path;
}

/** Seeded PRNG (mulberry32) so curation/shuffle is reproducible. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Map over items with bounded concurrency, preserving input order in the result. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export function shuffle<T>(arr: readonly T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
