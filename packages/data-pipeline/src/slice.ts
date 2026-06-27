import type { Candle, RawClip, Source, Timeframe } from './types';
import { PARAMS } from './config';
import { computeATR } from './util';

/**
 * Slice a chronological candle series into clips of CONTEXT + HORIZON candles at a
 * fixed stride. The last context candle is the freeze; the outcome is the real
 * close HORIZON candles later vs the freeze close (SPEC §3.1–3.2). Nothing is
 * synthesized — every value is real history.
 */
export function sliceSeries(
  candles: Candle[],
  asset: string,
  timeframe: Timeframe,
  source: Source,
): RawClip[] {
  const { CONTEXT, HORIZON, STRIDE } = PARAMS;
  const need = CONTEXT + HORIZON;
  const clips: RawClip[] = [];

  for (let i = 0; i + need <= candles.length; i += STRIDE) {
    const window = candles.slice(i, i + need);
    const context = window.slice(0, CONTEXT);
    const future = window.slice(CONTEXT);
    const freeze = context[CONTEXT - 1]!;
    const freezeClose = freeze.c;
    const finalClose = future[HORIZON - 1]!.c;
    const absMove = Math.abs(finalClose - freezeClose);

    clips.push({
      asset,
      timeframe,
      source,
      context,
      future,
      freezeT: freeze.t,
      freezeClose,
      outcome: finalClose > freezeClose ? 'up' : 'down',
      deltaPct: ((finalClose - freezeClose) / freezeClose) * 100,
      absMove,
      atr: computeATR(context),
    });
  }
  return clips;
}
