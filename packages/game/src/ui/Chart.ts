import type { Candle } from '../game/Puzzle';
import { colors } from '../brand/tokens';
import { clamp } from '../engine/math';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChartParams {
  context: Candle[];
  future: Candle[];
  /** How many context candles to draw (float → partial last candle fades in). */
  contextShown: number;
  /** How many future candles to draw (0 during the call; grows on reveal). */
  futureShown: number;
  /** Smoothed price range (caller-managed so the y-axis never jitters). */
  priceMin: number;
  priceMax: number;
  freezeClose: number;
  showFreezeLine: boolean;
}

/** Padded [min,max] price range over a candle set (used for the y-axis). */
export function chartPriceRange(candles: Candle[], pad = 0.1): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    if (c.l < lo) lo = c.l;
    if (c.h > hi) hi = c.h;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  const span = hi - lo || Math.abs(hi) * 0.01 || 1;
  return [lo - span * pad, hi + span * pad];
}

/**
 * Real-OHLC candlestick renderer. Candles occupy a stable grid of
 * context.length + future.length slots, so positions don't shift between playback,
 * freeze, and reveal — the future simply fills the reserved right-hand slots when
 * it's revealed (never before the call: fairness, SPEC §3). Per-candle up/down
 * coloring is the universal trading convention, not a brand signal.
 */
export function drawChart(ctx: CanvasRenderingContext2D, rect: Rect, p: ChartParams): void {
  const totalSlots = p.context.length + p.future.length;
  const slotW = rect.w / totalSlots;
  const bodyW = Math.max(2, slotW * 0.62);
  const wickW = Math.max(1, slotW * 0.1);
  const range = Math.max(1e-9, p.priceMax - p.priceMin);

  const yOf = (price: number): number =>
    rect.y + rect.h - clamp((price - p.priceMin) / range, 0, 1) * rect.h;

  const drawCandle = (c: Candle, slot: number, alpha: number): void => {
    const cx = rect.x + (slot + 0.5) * slotW;
    const up = c.c >= c.o;
    const col = up ? colors.up : colors.down;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = wickW;
    ctx.beginPath();
    ctx.moveTo(cx, yOf(c.h));
    ctx.lineTo(cx, yOf(c.l));
    ctx.stroke();
    const yO = yOf(c.o);
    const yC = yOf(c.c);
    ctx.fillRect(cx - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(1.5, Math.abs(yC - yO)));
    ctx.globalAlpha = 1;
  };

  // Freeze reference line (gold dashed) + the freeze divider, behind the candles.
  if (p.showFreezeLine) {
    const fy = yOf(p.freezeClose);
    ctx.save();
    ctx.strokeStyle = 'rgba(245,196,81,0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(rect.x, fy);
    ctx.lineTo(rect.x + rect.w, fy);
    ctx.stroke();
    ctx.setLineDash([]);
    const fx = rect.x + p.context.length * slotW;
    ctx.strokeStyle = 'rgba(138,148,166,0.28)';
    ctx.beginPath();
    ctx.moveTo(fx, rect.y);
    ctx.lineTo(fx, rect.y + rect.h);
    ctx.stroke();
    ctx.restore();
  }

  // Context candles.
  const nCtx = Math.min(p.context.length, Math.floor(p.contextShown));
  for (let i = 0; i < nCtx; i++) drawCandle(p.context[i]!, i, 1);
  const ctxFrac = p.contextShown - nCtx;
  if (nCtx < p.context.length && ctxFrac > 0.01) drawCandle(p.context[nCtx]!, nCtx, ctxFrac);

  // Future candles (reveal only).
  const base = p.context.length;
  const nFut = Math.min(p.future.length, Math.floor(p.futureShown));
  for (let i = 0; i < nFut; i++) drawCandle(p.future[i]!, base + i, 1);
  const futFrac = p.futureShown - nFut;
  if (nFut < p.future.length && futFrac > 0.01) drawCandle(p.future[nFut]!, base + nFut, futFrac);
}
