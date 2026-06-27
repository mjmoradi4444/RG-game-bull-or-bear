import { getHistoricalRates } from 'dukascopy-node';
import type { Candle, Timeframe } from '../types';
import { sleep } from '../util';

type DukaConfig = Parameters<typeof getHistoricalRates>[0];

const TF_MAP: Record<Timeframe, string> = { '5m': 'm5', '15m': 'm15', '1h': 'h1' };

/** Days per fetch window. A short window downloads few tick files, which is what
 *  keeps Dukascopy from resetting the connection ("fetch failed") on a long range.
 *  The 2-week smoke run was reliable, so we chunk the full range the same way. */
const CHUNK_DAYS = 14;
/** Manual retries on top of dukascopy-node's own, since "fetch failed" (undici
 *  connection reset) can still escape its retry on a flaky long pull. */
const CHUNK_RETRIES = 4;
const DAY_MS = 86_400_000;

/**
 * Fetch real OHLC from Dukascopy (free, no key) via dukascopy-node, which downloads
 * the historical tick files and aggregates them to the requested timeframe. Used
 * for FX / Gold / Oil (XAU/USD, EUR/USD, …).
 *
 * The full date range is fetched in CHUNK_DAYS windows with a pause between them:
 * a single large range reliably fails with "fetch failed" (the server resets the
 * connection partway through the heavy multi-file download), whereas short windows
 * succeed. Each chunk is retried, then all chunks are merged, deduped, and sorted.
 */
export async function fetchDukascopy(
  instrument: string,
  timeframe: Timeframe,
  fromISO: string,
  toISO: string,
): Promise<Candle[]> {
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  const merged: Candle[] = [];
  let chunks = 0;
  let failures = 0;

  for (let start = from; start < to; start += CHUNK_DAYS * DAY_MS) {
    const end = Math.min(start + CHUNK_DAYS * DAY_MS, to);
    chunks++;
    try {
      merged.push(...(await fetchChunk(instrument, timeframe, new Date(start), new Date(end))));
    } catch (e) {
      // A single flaky window must not wipe out a whole (possibly required) asset:
      // skip it and keep the rest. Only a total wipeout (below) is fatal.
      failures++;
      console.warn(`     · ${(e as Error).message}`);
    }
    await sleep(400);
  }

  if (merged.length === 0) {
    throw new Error(`dukascopy ${instrument} ${timeframe}: all ${chunks} chunks failed`);
  }
  if (failures > 0) {
    console.warn(`     · ${instrument} ${timeframe}: ${failures}/${chunks} windows skipped`);
  }
  return dedupeByTime(merged).sort((a, b) => a.t - b.t);
}

async function fetchChunk(
  instrument: string,
  timeframe: Timeframe,
  from: Date,
  to: Date,
): Promise<Candle[]> {
  const config = {
    instrument: instrument as DukaConfig['instrument'],
    dates: { from, to },
    timeframe: TF_MAP[timeframe] as DukaConfig['timeframe'],
    format: 'json',
    priceType: 'bid',
    retryCount: 3,
    pauseBetweenRetriesMs: 800,
  } as DukaConfig;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= CHUNK_RETRIES; attempt++) {
    try {
      const data = (await getHistoricalRates(config)) as Array<{
        timestamp: number;
        open: number;
        high: number;
        low: number;
        close: number;
      }>;
      return data.map((d) => ({ t: d.timestamp, o: d.open, h: d.high, l: d.low, c: d.close }));
    } catch (e) {
      lastErr = e;
      await sleep(1200 * attempt);
    }
  }
  throw new Error(
    `dukascopy ${instrument} ${timeframe} ${from.toISOString().slice(0, 10)}..${to
      .toISOString()
      .slice(0, 10)} failed after ${CHUNK_RETRIES} tries: ${(lastErr as Error)?.message}`,
  );
}

function dedupeByTime(candles: Candle[]): Candle[] {
  const seen = new Set<number>();
  const out: Candle[] = [];
  for (const c of candles) {
    if (seen.has(c.t)) continue;
    seen.add(c.t);
    out.push(c);
  }
  return out;
}
