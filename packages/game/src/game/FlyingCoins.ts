import { colors } from '../brand/tokens';
import { TAU } from '../engine/math';

/**
 * Gold rebate coins that arc from the trade point into the rebate jar — the
 * literal "the rebate pays, every trade" moment. Pooled; each coin follows a
 * quadratic bézier so it lofts up and drops into the jar, then fires an arrival
 * callback (used to pop + sparkle the jar).
 */
interface Coin {
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  tx: number;
  ty: number;
  t: number;
  dur: number;
  active: boolean;
}

export class FlyingCoins {
  private pool: Coin[] = [];

  constructor(max = 64) {
    for (let i = 0; i < max; i++) {
      this.pool.push({ sx: 0, sy: 0, cx: 0, cy: 0, tx: 0, ty: 0, t: 0, dur: 0.45, active: false });
    }
  }

  spawn(fromX: number, fromY: number, toX: number, toY: number, dur = 0.45): void {
    const c = this.pool.find((p) => !p.active);
    if (!c) return;
    c.sx = fromX;
    c.sy = fromY;
    c.tx = toX;
    c.ty = toY;
    // Control point above the line between the two points → a lofted arc.
    c.cx = (fromX + toX) / 2;
    c.cy = Math.min(fromY, toY) - 90;
    c.t = 0;
    c.dur = dur;
    c.active = true;
  }

  update(dt: number, onArrive: (x: number, y: number) => void): void {
    for (const c of this.pool) {
      if (!c.active) continue;
      c.t += dt / c.dur;
      if (c.t >= 1) {
        c.active = false;
        onArrive(c.tx, c.ty);
      }
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const c of this.pool) {
      if (!c.active) continue;
      const t = c.t < 0 ? 0 : c.t > 1 ? 1 : c.t;
      const u = 1 - t;
      const x = u * u * c.sx + 2 * u * t * c.cx + t * t * c.tx;
      const y = u * u * c.sy + 2 * u * t * c.cy + t * t * c.ty;
      const r = 7;

      const g = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, r);
      g.addColorStop(0, colors.rebateGoldLight);
      g.addColorStop(1, colors.rebateGold);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();

      // Specular shine.
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(x - 2.2, y - 2.2, 1.8, 0, TAU);
      ctx.fill();
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const c of this.pool) if (c.active) n++;
    return n;
  }
}
