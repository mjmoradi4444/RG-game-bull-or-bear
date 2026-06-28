import type { Candle } from '../game/Puzzle';
import { colors, fonts } from '../brand/tokens';
import { clamp } from '../engine/math';
import { roundRectPath } from './glass';

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
  /** '5m' | '15m' | '1h' — shown as the interval badge + drives the time axis. */
  timeframe: string;
}

/** Width reserved on the right for the price scale, and on the bottom for time. */
const PRICE_AXIS_W = 52;
const TIME_AXIS_H = 15;
const TF_MIN: Record<string, number> = { '5m': 5, '15m': 15, '1h': 60 };

/** Padded [min,max] price range over a candle set (used for the y-axis). */
export function chartPriceRange(candles: Candle[], pad = 0.12): [number, number] {
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
 * Real-OHLC candlestick renderer, styled like a professional trading terminal:
 * a right-hand price scale with grid + a live last-price tag, a relative time axis,
 * the freeze ("now") crosshair, and an interval badge. The data and mechanic are
 * unchanged — candles sit on a stable context+future slot grid so nothing shifts
 * between playback/freeze/reveal, and the future fills its reserved slots only on
 * reveal (never before the call — fairness, SPEC §3). Per-candle up/down coloring
 * is the universal trading convention, not a brand signal.
 */
export function drawChart(ctx: CanvasRenderingContext2D, rect: Rect, p: ChartParams): void {
  const plot: Rect = { x: rect.x, y: rect.y, w: rect.w - PRICE_AXIS_W, h: rect.h - TIME_AXIS_H };
  const totalSlots = p.context.length + p.future.length;
  const slotW = plot.w / totalSlots;
  const bodyW = Math.max(2, slotW * 0.6);
  const wickW = Math.max(1, slotW * 0.12);
  const range = Math.max(1e-9, p.priceMax - p.priceMin);
  const yOf = (price: number): number =>
    plot.y + plot.h - clamp((price - p.priceMin) / range, 0, 1) * plot.h;
  const dec = priceDecimals(p.freezeClose);
  const axisX = plot.x + plot.w;

  // --- price grid + right-axis labels ------------------------------------
  ctx.save();
  ctx.font = `${fonts.weight.medium} 10px ${fonts.family}`;
  ctx.textBaseline = 'middle';
  for (const t of niceTicks(p.priceMin, p.priceMax, 5)) {
    const y = yOf(t);
    if (y < plot.y - 0.5 || y > plot.y + plot.h + 0.5) continue;
    ctx.strokeStyle = 'rgba(138,148,166,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(axisX, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(138,148,166,0.7)';
    ctx.textAlign = 'left';
    ctx.fillText(fmtPrice(t, dec), axisX + 6, y);
  }

  // --- time axis (relative; absolute dates stay hidden — anti-lookup) -----
  ctx.font = `${fonts.weight.medium} 9px ${fonts.family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let slot = 0; slot <= totalSlots; slot += 10) {
    const x = plot.x + slot * slotW;
    if (x > axisX + 0.5) continue;
    ctx.strokeStyle = 'rgba(138,148,166,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.h);
    ctx.stroke();
    const off = slot - p.context.length;
    ctx.fillStyle = off === 0 ? 'rgba(245,196,81,0.85)' : 'rgba(138,148,166,0.6)';
    ctx.fillText(off === 0 ? 'now' : fmtRelTime(off, p.timeframe), x, plot.y + plot.h + 3);
  }
  ctx.restore();

  // --- freeze reference: gold dashed price line + the "now" divider -------
  if (p.showFreezeLine) {
    const fy = yOf(p.freezeClose);
    const fx = plot.x + p.context.length * slotW;
    ctx.save();
    ctx.strokeStyle = 'rgba(245,196,81,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(plot.x, fy);
    ctx.lineTo(axisX, fy);
    ctx.moveTo(fx, plot.y);
    ctx.lineTo(fx, plot.y + plot.h);
    ctx.stroke();
    ctx.restore();
  }

  // --- candles ------------------------------------------------------------
  const drawCandle = (c: Candle, slot: number, alpha: number): void => {
    const cx = plot.x + (slot + 0.5) * slotW;
    const col = c.c >= c.o ? colors.up : colors.down;
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

  const nCtx = Math.min(p.context.length, Math.floor(p.contextShown));
  for (let i = 0; i < nCtx; i++) drawCandle(p.context[i]!, i, 1);
  const ctxFrac = p.contextShown - nCtx;
  if (nCtx < p.context.length && ctxFrac > 0.01) drawCandle(p.context[nCtx]!, nCtx, ctxFrac);

  const base = p.context.length;
  const nFut = Math.min(p.future.length, Math.floor(p.futureShown));
  for (let i = 0; i < nFut; i++) drawCandle(p.future[i]!, base + i, 1);
  const futFrac = p.futureShown - nFut;
  if (nFut < p.future.length && futFrac > 0.01) drawCandle(p.future[nFut]!, base + nFut, futFrac);

  // --- last-price line + tag (the live "where price is now" marker) -------
  let lastPrice = p.freezeClose;
  let lastCandle: Candle | undefined;
  if (nFut > 0) lastCandle = p.future[nFut - 1];
  else if (nCtx > 0) lastCandle = p.context[nCtx - 1];
  if (lastCandle) lastPrice = lastCandle.c;
  const revealing = nFut > 0;
  const tagBg = revealing
    ? lastPrice >= p.freezeClose
      ? colors.up
      : colors.down
    : colors.brandBlueFrom;

  if (revealing) {
    const ly = yOf(lastPrice);
    ctx.save();
    ctx.strokeStyle = tagBg;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(plot.x, ly);
    ctx.lineTo(axisX, ly);
    ctx.stroke();
    ctx.restore();
  }
  const tagY = clamp(yOf(lastPrice), plot.y + 9, plot.y + plot.h - 9);
  drawTag(ctx, axisX, tagY, fmtPrice(lastPrice, dec), tagBg);

  // --- interval badge (top-left) -----------------------------------------
  drawBadge(ctx, plot.x + 6, plot.y + 6, p.timeframe.toUpperCase());
}

// ---- helpers -------------------------------------------------------------

function drawTag(ctx: CanvasRenderingContext2D, axisX: number, y: number, text: string, bg: string): void {
  const h = 16;
  ctx.save();
  roundRectPath(ctx, axisX + 1, y - h / 2, PRICE_AXIS_W - 2, h, 3);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = colors.text;
  ctx.font = `${fonts.weight.bold} 10px ${fonts.family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, axisX + PRICE_AXIS_W / 2, y);
  ctx.restore();
}

function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, label: string): void {
  ctx.save();
  ctx.font = `${fonts.weight.bold} 10px ${fonts.family}`;
  const w = ctx.measureText(label).width + 14;
  const h = 18;
  roundRectPath(ctx, x, y, w, h, 5);
  ctx.fillStyle = 'rgba(23,31,58,0.85)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = colors.border;
  ctx.stroke();
  ctx.fillStyle = colors.textMuted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
  ctx.restore();
}

/** ~`count` round price levels spanning [min,max]. */
function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

function priceDecimals(v: number): number {
  const a = Math.abs(v);
  if (a < 1) return 5;
  if (a < 10) return 4;
  if (a < 100) return 3;
  if (a < 1000) return 2;
  if (a < 10000) return 1;
  return 0;
}

function fmtPrice(v: number, dec: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtRelTime(offCandles: number, tf: string): string {
  const minutes = offCandles * (TF_MIN[tf] ?? 60);
  const sign = minutes < 0 ? '−' : '+';
  const a = Math.abs(minutes);
  if (a < 60) return `${sign}${a}m`;
  if (a < 1440) {
    const h = a / 60;
    return `${sign}${Number.isInteger(h) ? h : h.toFixed(1)}h`;
  }
  const d = a / 1440;
  return `${sign}${Number.isInteger(d) ? d : d.toFixed(1)}d`;
}
