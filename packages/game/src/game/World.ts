import type { Viewport } from '../engine/Viewport';
import type { Rng } from '../engine/Rng';
import type { Outcome } from './types';
import { clamp } from '../engine/math';
import { colors } from '../brand/tokens';

/**
 * The scrolling price chart (grey-box).
 *
 * Candles stream right-to-left and are NEUTRAL grey until you trade them. Firing
 * resolves the candle nearest the fire line to win (green) or loss (red). Outcomes
 * are intentionally "streaky" — a drifting win-probability gives market-like runs
 * without ever being predictable or skill-determined (SPEC §4.2). Dual meters,
 * lives, combo and difficulty arrive in Phase 3; this proves the engine.
 */

interface Candle {
  x: number; // left edge in CSS px, scrolls leftward
  w: number;
  openN: number; // normalized price 0..1 (0 = bottom of band, 1 = top)
  closeN: number;
  highN: number;
  lowN: number;
  outcome: Outcome | null; // null = untraded (neutral)
  flash: number; // 0..1 glow that fades after resolve
}

export class World {
  private candles: Candle[] = [];
  private priceN = 0.5;
  private bias = 0.5; // win probability; drifts to create streaks
  private gap: number;
  speed: number; // px/s

  constructor(
    private readonly vp: Viewport,
    private readonly rng: Rng,
  ) {
    this.speed = Math.max(70, vp.w * 0.16);
    this.gap = Math.max(14, vp.w * 0.052);
    // Prefill the screen so play starts mid-stream, not empty.
    let x = 0;
    while (x < vp.w + this.gap) {
      this.candles.push(this.makeCandle(x));
      x += this.gap;
    }
  }

  private get chartTop(): number {
    return this.vp.h * 0.2;
  }

  private get chartBottom(): number {
    return this.vp.h * 0.8;
  }

  get fireX(): number {
    return this.vp.w * 0.32;
  }

  private priceToY(n: number): number {
    return this.chartBottom - n * (this.chartBottom - this.chartTop);
  }

  private makeCandle(x: number): Candle {
    const open = this.priceN;
    // Random walk with mild mean reversion so price stays on screen.
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
      flash: 0,
    };
  }

  update(dt: number): void {
    const dx = this.speed * dt;
    for (const c of this.candles) {
      c.x -= dx;
      if (c.flash > 0) c.flash = Math.max(0, c.flash - dt * 1.6);
    }
    // Despawn off the left edge.
    while (this.candles.length && this.candles[0]!.x + this.candles[0]!.w < -4) {
      this.candles.shift();
    }
    // Spawn off the right edge.
    let lastX = this.candles.length ? this.candles[this.candles.length - 1]!.x : -this.gap;
    while (lastX < this.vp.w + this.gap) {
      lastX += this.gap;
      this.candles.push(this.makeCandle(lastX));
    }
  }

  /**
   * Resolve the untraded candle nearest the fire line. Returns the outcome and the
   * candle's screen position (for coin particles), or null if none is close enough.
   */
  fire(): { outcome: Outcome; x: number; y: number } | null {
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
    if (!best || bestD > this.gap * 2) return null;

    const win = this.rng.next() < this.bias;
    best.outcome = win ? 'win' : 'loss';
    best.flash = 1;
    // Nudge the streak, clamped so neither runaway wins nor losses.
    this.bias = clamp(this.bias + (win ? 0.1 : -0.12), 0.28, 0.72);

    return { outcome: best.outcome, x: best.x + best.w / 2, y: this.priceToY(best.closeN) };
  }

  render(ctx: CanvasRenderingContext2D): void {
    const fx = this.fireX;

    // Fire line — subtle dashed vertical guide at the trade point.
    ctx.save();
    ctx.strokeStyle = 'rgba(138,148,166,0.25)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.moveTo(fx, this.chartTop - 12);
    ctx.lineTo(fx, this.chartBottom + 12);
    ctx.stroke();
    ctx.restore();

    for (const c of this.candles) {
      if (c.x > this.vp.w || c.x + c.w < 0) continue;
      const cx = c.x + c.w / 2;
      const bodyTop = this.priceToY(Math.max(c.openN, c.closeN));
      const bodyBot = this.priceToY(Math.min(c.openN, c.closeN));
      const wickTop = this.priceToY(c.highN);
      const wickBot = this.priceToY(c.lowN);

      let col = 'rgba(138,148,166,0.5)'; // neutral / untraded
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
      const bh = Math.max(2, bodyBot - bodyTop);
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
    }
  }
}
