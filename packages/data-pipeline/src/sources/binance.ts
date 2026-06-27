import type { Candle, Timeframe } from '../types';
import { sleep } from '../util';

/**
 * Fetch real OHLC klines from Binance (free, no key). Paginates backwards from now
 * using endTime until `total` candles are collected. Real UTC open times are kept
 * for the verify field. Source: https://api.binance.com/api/v3/klines
 */
export async function fetchBinance(symbol: string, timeframe: Timeframe, total: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let endTime: number | undefined;

  while (out.length < total) {
    const limit = Math.min(1000, total - out.length);
    const url = new URL('https://api.binance.com/api/v3/klines');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', timeframe);
    url.searchParams.set('limit', String(limit));
    if (endTime !== undefined) url.searchParams.set('endTime', String(endTime));

    const res = await fetch(url);
    if (!res.ok) throw new Error(`binance ${symbol} ${timeframe} HTTP ${res.status}`);
    const rows = (await res.json()) as unknown[];
    if (rows.length === 0) break;

    const batch = (rows as Array<[number, string, string, string, string]>).map((r) => ({
      t: r[0],
      o: +r[1],
      h: +r[2],
      l: +r[3],
      c: +r[4],
    }));
    out.unshift(...batch);
    endTime = (rows[0] as [number])[0] - 1;
    if (rows.length < limit) break;
    await sleep(150);
  }

  out.sort((a, b) => a.t - b.t);
  return dedupeByTime(out).slice(-total);
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
