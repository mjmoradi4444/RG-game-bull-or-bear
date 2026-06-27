import type { Viewport } from '../engine/Viewport';
import type { Rng } from '../engine/Rng';
import type { Difficulty } from './Difficulty';
import type { Outcome } from './types';
import { clamp } from '../engine/math';
import { colors } from '../brand/tokens';

/**
 * The scrolling price chart.
 *
 * Candles stream right-to-left and are NEUTRAL until you trade them; firing
 * resolves the candle nearest the fire line to win (green) or loss (red).
 * Outcomes are intentionally "streaky" (a drifting win-probability) so runs feel
 * market-like without ever being predictable or skill-determined (SPEC §4.2).
 *
 * Some candles are flagged HIGH SPREAD — telegraphed with a pulsing red outline
 * and a warning tag as they approach. Trading one still pays the rebate (every
 * trade does), but it costs a life: the game's only skill/discipline layer.
 */

export interface FireResult {
  outcome: Outcome;
  x: number;
  y: number;
  highSpread: boolean;
}

interface Candle {
  x: number;
  w: number;
  openN: number;
  closeN: number;
  highN: number;
  lowN: number;
  outcome: Outcome | null;
  highSpread: boolean;
  flash: number;
}

const HAZARD = '#FF5C3D';

export class World {
  private candles: Candle[] = [];
  private priceN = 0.5;
  private bias = 0.5;
  private readonly baseSpeed: number;
  private readonly gap: number;
  private pulse = 0;

  constructor(
    private readonly vp: Viewport,
    private readonly rng: Rng,
    private readonly difficulty: Difficulty,
  ) {
    this.baseSpeed = Math.max(70, vp.w * 0.16);
    this.gap = Math.max(14, vp.w * 0.052);
    let x = 0;
    while (x < vp.w + this.gap) {
      this.candles.push(this.makeCandle(x, false));
      x += this.gap;
    }
  }

  private get chartTop(): number {
    return this.vp.h * 0.22;
  }

  private get chartBottom(): number {
    return this.vp.h * 0.82;
  }

  get fireX(): number {
    return this.vp.w * 0.32;
  }

  private priceToY(n: number): number {
    return this.chartBottom - n * (this.chartBottom - this.chartTop);
  }

  private makeCandle(x: number, allowHazard: boolean): Candle {
    const open = this.priceN;
    const delta = (this.rng.next() - 0.5) * 0.14 + (0.5 - this.priceN) * 0.04;
    const close = clamp(open + delta, 0.08, 0.92);
    const high = clamp(Math.max(open, close) + this.rng.next() * 0.04, 0, 1);
    const low = clamp(Math.min(open, close) - this.rng.next() * 0.04, 0, 1);
    this.priceN = close;
    return {
      x,
      w: Math.max(8, this.gap * 0.62),
      openN: open,
      closeN: close,
      highN: high,
      lowN: low,
      outcome: null,
      highSpread: allowHazard && this.rng.chance(this.difficulty.hazardChance),
      flash: 0,
    };
  }

  update(dt: number): void {
    this.pulse += dt;
    const dx = this.baseSpeed * this.difficulty.speedMul * dt;
    for (const c of this.candles) {
      c.x -= dx;
      if (c.flash > 0) c.flash = Math.max(0, c.flash - dt * 1.6);
    }
    while (this.candles.length && this.candles[0]!.x + this.candles[0]!.w < -4) {
      this.candles.shift();
    }
    let lastX = this.candles.length ? this.candles[this.candles.length - 1]!.x : -this.gap;
    while (lastX < this.vp.w + this.gap) {
      lastX += this.gap;
      this.candles.push(this.makeCandle(lastX, true));
    }
  }

  /** Is there an untraded candle close enough to the fire line to trade right now? */
  hasTarget(): boolean {
    return this.nearestTarget() !== null;
  }

  private nearestTarget(): Candle | null {
    const fx = this.fireX;
    let best: Candle | null = null;
    let bestD = Infinity;
    for (const c of this.candles) {
      if (c.outcome) continue;
      const cx = c.x + c.w / 2;
      const d = Math.abs(cx - fx);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best && bestD <= this.gap * 2 ? best : null;
  }

  fire(): FireResult | null {
    const best = this.nearestTarget();
    if (!best) return null;

    const win = this.rng.next() < this.bias;
    best.outcome = win ? 'win' : 'loss';
    best.flash = 1;
    this.bias = clamp(this.bias + (win ? 0.1 : -0.12), 0.28, 0.72);

    return {
      outcome: best.outcome,
      x: best.x + best.w / 2,
      y: this.priceToY(best.closeN),
      highSpread: best.highSpread,
    };
  }

  render(ctx: CanvasRenderingContext2D): void {
    const fx = this.fireX;

    // Fire line — subtle dashed vertical guide at the trade point.
    ctx.save();
    ctx.strokeStyle = 'rgba(138,148,166,0.22)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.moveTo(fx, this.chartTop - 14);
    ctx.lineTo(fx, this.chartBottom + 14);
    ctx.stroke();
    ctx.restore();

    for (const c of this.candles) {
      if (c.x > this.vp.w || c.x + c.w < 0) continue;
      this.renderCandle(ctx, c);
    }
  }

  private renderCandle(ctx: CanvasRenderingContext2D, c: Candle): void {
    const cx = c.x + c.w / 2;
    const bodyTop = this.priceToY(Math.max(c.openN, c.closeN));
    const bodyBot = this.priceToY(Math.min(c.openN, c.closeN));
    const wickTop = this.priceToY(c.highN);
    const wickBot = this.priceToY(c.lowN);
    const bh = Math.max(2, bodyBot - bodyTop);

    let col = 'rgba(138,148,166,0.5)';
    if (c.outcome === 'win') col = colors.up;
    else if (c.outcome === 'loss') col = colors.down;

    // Wick.
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1.5, c.w * 0.12);
    ctx.beginPath();
    ctx.moveTo(cx, wickTop);
    ctx.lineTo(cx, wickBot);
    ctx.stroke();

    // Body (glows briefly when freshly resolved).
    ctx.fillStyle = col;
    if (c.flash > 0) {
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = 18 * c.flash;
      ctx.fillRect(c.x, bodyTop, c.w, bh);
      ctx.restore();
    } else {
      ctx.fillRect(c.x, bodyTop, c.w, bh);
    }

    // HIGH-SPREAD telegraph — only while still untraded.
    if (c.highSpread && !c.outcome) {
      const a = 0.5 + 0.5 * Math.sin(this.pulse * 6);
      ctx.save();
      ctx.strokeStyle = HAZARD;
      ctx.globalAlpha = 0.55 + 0.45 * a;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      const pad = 4;
      ctx.strokeRect(c.x - pad, wickTop - pad, c.w + pad * 2, wickBot - wickTop + pad * 2);
      ctx.setLineDash([]);

      // Warning tag above the candle.
      ctx.globalAlpha = 1;
      ctx.fillStyle = HAZARD;
      ctx.font = '700 9px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('⚠ SPREAD', cx, wickTop - pad - 3);
      ctx.restore();
    }
  }
}
