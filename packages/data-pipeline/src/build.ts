import 'dotenv/config';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ASSETS, BINANCE_CANDLES, DUKA_FROM, DUKA_TO, FETCH_CONCURRENCY, PARAMS } from './config';
import type { AssetSpec } from './config';
import type { Candle, RawClip, StoredPuzzle, Timeframe } from './types';
import { fetchBinance } from './sources/binance';
import { fetchDukascopy } from './sources/dukascopy';
import { PKG_ROOT, readSeriesCache, writeSeriesCache } from './cache';
import { mapLimit } from './util';
import { sliceSeries } from './slice';
import { curate } from './curate';
import type { CurateStats } from './curate';

const OUT = join(PKG_ROOT, '..', 'game', 'src', 'data', 'puzzles.json');

// SMOKE=1 → tiny, fast end-to-end validation (a few assets, short window).
const SMOKE = !!process.env.SMOKE;
const dukaFrom = process.env.DUKA_FROM ?? (SMOKE ? '2026-05-18' : DUKA_FROM);
const dukaTo = process.env.DUKA_TO ?? (SMOKE ? '2026-05-31' : DUKA_TO);
const binCandles = process.env.BINANCE_CANDLES ? Number(process.env.BINANCE_CANDLES) : SMOKE ? 1000 : BINANCE_CANDLES;
const assets = SMOKE ? ASSETS.filter((a) => ['BTC', 'XAU/USD', 'EUR/USD'].includes(a.asset)) : ASSETS;

async function getSeries(spec: AssetSpec, tf: Timeframe): Promise<Candle[]> {
  const tag = spec.source === 'dukascopy' ? `${dukaFrom}_${dukaTo}` : String(binCandles);
  const key = `${spec.source}_${spec.symbol}_${tf}_${tag}`;
  const cached = readSeriesCache<Candle[]>(key);
  if (cached) {
    console.log(`  cache  ${spec.asset.padEnd(8)} ${tf.padEnd(3)} ${cached.length} candles`);
    return cached;
  }
  const series =
    spec.source === 'binance'
      ? await fetchBinance(spec.symbol, tf, binCandles)
      : await fetchDukascopy(spec.symbol, tf, dukaFrom, dukaTo);
  writeSeriesCache(key, series);
  console.log(`  fetch  ${spec.asset.padEnd(8)} ${tf.padEnd(3)} ${series.length} candles`);
  return series;
}

async function main(): Promise<void> {
  console.log(
    `Bull or Bear puzzle build${SMOKE ? ' [SMOKE]' : ''} · dukascopy ${dukaFrom}..${dukaTo} · binance ${binCandles}/tf\n`,
  );

  const precision: Record<string, number> = {};
  const jobs: { spec: AssetSpec; tf: Timeframe }[] = [];
  for (const spec of assets) {
    precision[spec.asset] = spec.pricePrecision;
    for (const tf of spec.timeframes) jobs.push({ spec, tf });
  }

  // Fetch series with bounded concurrency: crypto is cached/instant, the slow
  // Dukascopy tick pulls overlap to cut wall-time. Results stay in job order, so
  // the downstream slice/curate output is stable.
  const fetched = await mapLimit(jobs, FETCH_CONCURRENCY, async ({ spec, tf }) => {
    try {
      return { spec, tf, series: await getSeries(spec, tf) };
    } catch (e) {
      console.warn(`  !! ${spec.asset} ${tf} failed: ${(e as Error).message}`);
      return { spec, tf, series: [] as Candle[] };
    }
  });

  const allClips: RawClip[] = [];
  for (const { spec, tf, series } of fetched) {
    if (series.length) allClips.push(...sliceSeries(series, spec.asset, tf, spec.source));
  }

  const { puzzles, stats } = curate(allClips, precision);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(puzzles));
  printStats(puzzles, stats);
}

function printStats(puzzles: StoredPuzzle[], stats: CurateStats): void {
  const byAsset = new Map<string, { up: number; down: number }>();
  const byTf = new Map<string, number>();
  const byDiff = new Map<string, number>();
  let up = 0;
  for (const p of puzzles) {
    const a = byAsset.get(p.asset) ?? { up: 0, down: 0 };
    if (p.o === 'up') {
      a.up++;
      up++;
    } else a.down++;
    byAsset.set(p.asset, a);
    byTf.set(p.tf, (byTf.get(p.tf) ?? 0) + 1);
    byDiff.set(p.d, (byDiff.get(p.d) ?? 0) + 1);
  }

  const total = puzzles.length || 1;
  const sizeKb = (statSync(OUT).size / 1024).toFixed(0);
  console.log(`\n=========== FAIRNESS STATS ===========`);
  console.log(`puzzles: ${puzzles.length}   (${sizeKb} KB on disk)`);
  console.log(`balance: up ${up} (${((up / total) * 100).toFixed(1)}%)  /  down ${puzzles.length - up}`);
  console.log(
    `degenerate filter: ${stats.totalRaw} raw → ${stats.afterDegenerateDrop} kept (dropped ${stats.droppedDegenerate})`,
  );
  console.log(
    `ranging filter (ER≥${PARAMS.ER_MIN_TREND}): ${stats.afterDegenerateDrop} → ${stats.afterRangingDrop} kept (dropped ${stats.droppedRanging})`,
  );
  console.log(
    `difficulty: ${['easy', 'med', 'hard'].map((d) => `${d}:${byDiff.get(d) ?? 0}`).join('  ')}`,
  );
  console.log(`timeframes: ${[...byTf].map(([k, v]) => `${k}:${v}`).join('  ')}`);
  console.log(`by asset:`);
  for (const [a, { up: u, down: d }] of [...byAsset].sort((x, y) => x[0].localeCompare(y[0]))) {
    console.log(`  ${a.padEnd(9)} ${String(u + d).padStart(3)}   up ${String(u).padStart(3)} / down ${String(d).padStart(3)}`);
  }
  for (const req of ['XAU/USD', 'EUR/USD']) {
    const e = byAsset.get(req);
    const n = e ? e.up + e.down : 0;
    console.log(`  required ${req}: ${n > 0 ? `PRESENT (${n}) OK` : 'MISSING — FAIL'}`);
  }
  if (!SMOKE && puzzles.length < PARAMS.TARGET_MIN) {
    console.log(`\n  NOTE: ${puzzles.length} < target ${PARAMS.TARGET_MIN}. Widen DUKA range, lower ER_MIN_TREND, or raise PER_GROUP_CAP.`);
  }
  console.log(`\nWrote → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
