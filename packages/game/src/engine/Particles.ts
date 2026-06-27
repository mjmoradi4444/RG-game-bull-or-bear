/**
 * Pooled 2D particle system. Particles are pre-allocated once and recycled, so a
 * burst never allocates during play (no GC hitches). Used first for the gold
 * rebate-coin burst on every trade; reused for win/loss pops and brand moments.
 */
import type { Rng } from './Rng';
import { TAU } from './math';

export interface BurstOptions {
  /** RGB triple, 0–255. */
  color: [number, number, number];
  /** Particle count. */
  count: number;
  /** [min, max] initial speed in px/s. */
  speed: [number, number];
  /** [min, max] lifetime in seconds. */
  life: [number, number];
  /** [min, max] radius in px. */
  size: [number, number];
  /** Downward acceleration in px/s². */
  gravity: number;
  /** [min, max] emission angle in radians (0 = right, -PI/2 = up). */
  spread: [number, number];
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
  gravity: number;
  active: boolean;
}

export class Particles {
  private pool: Particle[] = [];

  constructor(
    private readonly rng: Rng,
    max = 400,
  ) {
    for (let i = 0; i < max; i++) {
      this.pool.push({
        x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, size: 1,
        r: 255, g: 255, b: 255, gravity: 0, active: false,
      });
    }
  }

  burst(x: number, y: number, opts: BurstOptions): void {
    let spawned = 0;
    for (const p of this.pool) {
      if (spawned >= opts.count) break;
      if (p.active) continue;
      const ang = this.rng.range(opts.spread[0], opts.spread[1]);
      const spd = this.rng.range(opts.speed[0], opts.speed[1]);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.maxLife = this.rng.range(opts.life[0], opts.life[1]);
      p.life = p.maxLife;
      p.size = this.rng.range(opts.size[0], opts.size[1]);
      p.r = opts.color[0];
      p.g = opts.color[1];
      p.b = opts.color[2];
      p.gravity = opts.gravity;
      p.active = true;
      spawned++;
    }
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) p.active = false;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      const a = p.life / p.maxLife;
      ctx.globalAlpha = a < 0 ? 0 : a;
      ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  get activeCount(): number {
    let n = 0;
    for (const p of this.pool) if (p.active) n++;
    return n;
  }
}
