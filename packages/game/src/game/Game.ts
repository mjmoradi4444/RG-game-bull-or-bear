import type { Viewport } from '../engine/Viewport';
import type { Input } from '../engine/Input';
import type { Audio } from '../engine/Audio';
import type { Particles } from '../engine/Particles';
import type { Rng } from '../engine/Rng';
import type { GameState } from './types';
import { World } from './World';
import { colors, fonts } from '../brand/tokens';
import { drawGlassPanel } from '../ui/glass';

/**
 * Phase 2 orchestrator: a state machine (title → playing) wiring input, the
 * scrolling world, particles, and audio into one update/render pair driven by the
 * Loop. The HUD here is a deliberate grey-box (a trade counter + debug readout) —
 * the real dual P&L / rebate meters, lives, combo and scoring land in Phase 3.
 */
export class Game {
  private state: GameState = 'title';
  private readonly world: World;

  private trades = 0;
  private wins = 0;
  private losses = 0;

  private readonly lockup = new Image();
  private lockupReady = false;

  private pulse = 0; // drives the "tap to start" pulse
  private fps = 0;
  private fpsFrames = 0;
  private fpsTime = 0;

  constructor(
    private readonly vp: Viewport,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly particles: Particles,
    rng: Rng,
  ) {
    this.world = new World(vp, rng);
    this.lockup.onload = () => {
      this.lockupReady = true;
    };
    this.lockup.src = '/brand/Logo2.png';
  }

  update(dt: number): void {
    this.pulse += dt;

    if (this.input.consumeFire()) {
      if (this.state === 'title') this.state = 'playing';
      else this.fire();
    }

    if (this.state === 'playing') this.world.update(dt);
    this.particles.update(dt);

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }

  private fire(): void {
    const res = this.world.fire();
    if (!res) return;

    this.trades++;
    if (res.outcome === 'win') {
      this.wins++;
      this.audio.win();
    } else {
      this.losses++;
      this.audio.loss();
    }

    // The teaching moment (grey-box): a gold rebate coin burst on EVERY trade,
    // win or loss. Becomes the jar fill + juice in Phases 3–4.
    this.audio.coin();
    this.particles.burst(res.x, res.y, {
      color: [245, 196, 81],
      count: 16,
      speed: [60, 230],
      life: [0.5, 0.95],
      size: [2, 4.5],
      gravity: 430,
      spread: [-Math.PI * 0.92, -Math.PI * 0.08], // fan upward
    });
  }

  render(_alpha: number): void {
    const { ctx, w, h } = this.vp;
    this.vp.begin();

    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);

    if (this.state === 'playing') {
      this.world.render(ctx);
      this.particles.render(ctx);
      this.renderHud();
    } else {
      this.renderTitle();
      this.particles.render(ctx);
    }

    this.renderDebug();
  }

  private renderTitle(): void {
    const { ctx, w, h } = this.vp;
    const cx = w / 2;

    if (this.lockupReady) {
      const lw = Math.min(w * 0.5, 280);
      const lh = lw * (this.lockup.height / this.lockup.width);
      const pad = Math.max(18, lw * 0.09);
      const plateW = lw + pad * 2;
      const plateH = lh + pad * 2;
      const plateX = cx - plateW / 2;
      const plateY = h * 0.27 - plateH / 2;
      drawGlassPanel(ctx, plateX, plateY, plateW, plateH, Math.min(28, plateH * 0.22));
      ctx.drawImage(this.lockup, plateX + pad, plateY + pad, lw, lh);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.black} ${Math.min(w * 0.11, 48)}px ${fonts.family}`;
    ctx.fillText('Rebate Rush', cx, h * 0.45);

    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.medium} ${Math.min(w * 0.042, 18)}px ${fonts.family}`;
    ctx.fillText('Win or lose, the rebate pays.', cx, h * 0.45 + 34);

    // Pulsing prompt.
    const a = 0.55 + 0.45 * Math.sin(this.pulse * 3);
    ctx.globalAlpha = a;
    ctx.fillStyle = colors.rebateGold;
    ctx.font = `${fonts.weight.semibold} ${Math.min(w * 0.05, 20)}px ${fonts.family}`;
    ctx.fillText('Tap to start', cx, h * 0.62);
    ctx.globalAlpha = 1;
  }

  private renderHud(): void {
    const { ctx, w } = this.vp;
    ctx.textBaseline = 'alphabetic';

    // Grey-box placeholders for the two meters (real ones in Phase 3).
    ctx.textAlign = 'left';
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.semibold} 13px ${fonts.family}`;
    ctx.fillText('P&L (grey-box)', 16, 30);
    ctx.fillStyle = this.wins - this.losses >= 0 ? colors.up : colors.down;
    ctx.font = `${fonts.weight.bold} 20px ${fonts.family}`;
    ctx.fillText(`${this.wins - this.losses >= 0 ? '+' : ''}${this.wins - this.losses}`, 16, 54);

    ctx.textAlign = 'right';
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.semibold} 13px ${fonts.family}`;
    ctx.fillText('Rebate (grey-box)', w - 16, 30);
    ctx.fillStyle = colors.rebateGold;
    ctx.font = `${fonts.weight.bold} 20px ${fonts.family}`;
    ctx.fillText(`${this.trades}`, w - 16, 54);
  }

  private renderDebug(): void {
    const { ctx, h } = this.vp;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(138,148,166,0.6)';
    ctx.font = `${fonts.weight.medium} 11px ${fonts.family}`;
    ctx.fillText(
      `phase 2 · ${this.fps} fps · particles ${this.particles.activeCount} · ${this.state}`,
      16,
      h - 16,
    );
  }
}
