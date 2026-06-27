import type { Viewport } from '../engine/Viewport';
import type { Input } from '../engine/Input';
import type { Audio } from '../engine/Audio';
import type { Particles } from '../engine/Particles';
import type { Rng } from '../engine/Rng';
import type { TelegramAdapter } from '../telegram/TelegramAdapter';
import type { GameState } from './types';
import { Scoring } from './Scoring';
import { Difficulty } from './Difficulty';
import { World } from './World';
import { FlyingCoins } from './FlyingCoins';
import { BROKER_TIERS } from './Brokers';
import { Hud, type HudState } from '../ui/Hud';
import { drawGlassPanel } from '../ui/glass';
import { colors, fonts } from '../brand/tokens';
import { damp } from '../engine/math';

const MAX_LIVES = 3;
const COOLDOWN = 0.35; // seconds between trades
const TOAST_SECONDS = 2.4;

/**
 * The game orchestrator. Owns the state machine (title → playing → gameover) and
 * ties input, the scrolling world, scoring, lives, particles, coins and the HUD
 * into one update/render pair. Stays Telegram-agnostic: it only ever talks to the
 * injected TelegramAdapter (haptics now, score submission on game over).
 */
export class Game {
  private state: GameState = 'title';
  private readonly hud = new Hud();
  private readonly coins = new FlyingCoins();

  private scoring: Scoring;
  private difficulty = new Difficulty();
  private world: World;

  private lives = MAX_LIVES;
  private cooldown = 0;
  private gameoverLock = 0; // brief input lock so an in-flight tap can't skip the payoff

  // Tweened display values + juice timers.
  private dispRebate = 0;
  private dispPnl = 0;
  private pnlFlash = 0;
  private jarBump = 0;
  private shake = 0;

  private toastText: string | null = null;
  private toastT = 0;

  private finalRebate = 0;
  private finalPnl = 0;

  private muted = false;
  private pulse = 0;

  private readonly lockup = new Image();
  private lockupReady = false;

  constructor(
    private readonly vp: Viewport,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly particles: Particles,
    private readonly rng: Rng,
    private readonly adapter: TelegramAdapter,
  ) {
    this.scoring = new Scoring(rng);
    this.world = new World(vp, rng, this.difficulty);
    this.lockup.onload = () => {
      this.lockupReady = true;
    };
    this.lockup.src = '/brand/Logo2.png';
  }

  // ---- lifecycle ---------------------------------------------------------

  private startRun(): void {
    this.scoring = new Scoring(this.rng);
    this.difficulty = new Difficulty();
    this.world = new World(this.vp, this.rng, this.difficulty);
    this.lives = MAX_LIVES;
    this.cooldown = 0;
    this.dispRebate = 0;
    this.dispPnl = 0;
    this.pnlFlash = 0;
    this.jarBump = 0;
    this.shake = 0;
    this.toastT = 0;
    this.state = 'playing';
  }

  private gameOver(): void {
    this.finalRebate = this.scoring.rebate;
    this.finalPnl = this.scoring.pnl;
    this.state = 'gameover';
    this.gameoverLock = 0.6;
    this.audio.loss();
    void this.adapter.submitScore(Math.round(this.scoring.rebate));
  }

  // ---- update ------------------------------------------------------------

  update(dt: number): void {
    this.pulse += dt;

    if (this.input.consumeFire()) this.onTap();

    if (this.state === 'playing') {
      this.difficulty.update(dt);
      this.world.update(dt);
      this.cooldown = Math.max(0, this.cooldown - dt);
    }
    this.gameoverLock = Math.max(0, this.gameoverLock - dt);

    this.coins.update(dt, (x, y) => this.onCoinArrive(x, y));
    this.particles.update(dt);

    // Tween meters toward their true values.
    this.dispRebate = damp(this.dispRebate, this.scoring.rebate, 14, dt);
    this.dispPnl = damp(this.dispPnl, this.scoring.pnl, 11, dt);

    // Decay juice timers.
    this.pnlFlash = Math.max(0, this.pnlFlash - dt * 2.6);
    this.jarBump = Math.max(0, this.jarBump - dt * 3);
    this.shake = Math.max(0, this.shake - dt);
    if (this.toastT > 0) this.toastT = Math.max(0, this.toastT - dt / TOAST_SECONDS);
  }

  private onTap(): void {
    if (this.state === 'title') {
      this.startRun();
      return;
    }
    if (this.state === 'gameover') {
      if (this.gameoverLock <= 0) this.startRun();
      return;
    }
    // playing
    if (this.hitMuteButton()) {
      this.toggleMute();
      return;
    }
    if (this.cooldown > 0) return;
    const res = this.world.fire();
    if (!res) return;

    this.cooldown = COOLDOWN;
    const tr = this.scoring.applyTrade(res.outcome);

    // Outcome feedback (P&L side — cosmetic).
    if (res.outcome === 'win') {
      this.audio.win();
      this.adapter.haptic('success');
    } else {
      this.audio.loss();
      this.adapter.haptic('impact');
      this.pnlFlash = 1;
      this.shake = Math.max(this.shake, 0.18);
    }

    // Rebate side — the teaching moment. Always pays, every trade.
    this.audio.coin();
    const jar = Hud.jarPos(this.vp);
    this.coins.spawn(res.x, res.y, jar.x, jar.y);
    this.particles.burst(res.x, res.y, {
      color: [245, 196, 81],
      count: 8,
      speed: [40, 150],
      life: [0.35, 0.7],
      size: [1.5, 3],
      gravity: 380,
      spread: [-Math.PI * 0.85, -Math.PI * 0.15],
    });

    // HIGH-SPREAD discipline layer — costs a life, never the rebate.
    if (res.highSpread) {
      this.lives--;
      this.scoring.breakCombo();
      this.adapter.haptic('warning');
      this.shake = Math.max(this.shake, 0.35);
      this.showToast('HIGH SPREAD · −1 life');
      if (this.lives <= 0) {
        this.gameOver();
        return;
      }
    }

    // Broker unlock.
    if (tr.unlockedTierIndex !== null) {
      const t = BROKER_TIERS[tr.unlockedTierIndex]!;
      this.showToast(`New broker · ${t.name} ×${t.multiplier.toFixed(1)}`);
      this.adapter.haptic('success');
    }
  }

  private onCoinArrive(x: number, y: number): void {
    this.jarBump = 1;
    this.particles.burst(x, y, {
      color: [255, 224, 138],
      count: 6,
      speed: [20, 90],
      life: [0.25, 0.5],
      size: [1.5, 2.5],
      gravity: -40,
      spread: [-Math.PI, 0],
    });
  }

  private showToast(text: string): void {
    this.toastText = text;
    this.toastT = 1;
  }

  private toggleMute(): void {
    this.muted = !this.muted;
    this.audio.setMuted(this.muted);
  }

  // Mute button hit-box (bottom-left).
  private muteRect(): { x: number; y: number; w: number; h: number } {
    return { x: 12, y: this.vp.h - 46, w: 56, h: 30 };
  }

  private hitMuteButton(): boolean {
    const r = this.muteRect();
    const px = this.input.pointerX;
    const py = this.input.pointerY;
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  // ---- render ------------------------------------------------------------

  render(_alpha: number): void {
    const { ctx, w, h } = this.vp;
    this.vp.begin();
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);

    if (this.state === 'title') {
      this.renderTitle();
      this.particles.render(ctx);
      return;
    }

    // World (with screen shake), then juice + HUD on top (stable).
    ctx.save();
    if (this.shake > 0) {
      const m = 9 * this.shake;
      ctx.translate((Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m);
    }
    this.world.render(ctx);
    ctx.restore();

    this.particles.render(ctx);
    this.coins.render(ctx);
    this.hud.render(ctx, this.vp, this.snapshot());
    this.renderMuteButton();

    if (this.state === 'gameover') this.renderGameOver();
  }

  private snapshot(): HudState {
    return {
      rebate: this.dispRebate,
      pnl: this.dispPnl,
      pnlFlash: this.pnlFlash,
      combo: this.scoring.combo,
      comboMul: this.scoring.comboMultiplier,
      lives: this.lives,
      maxLives: MAX_LIVES,
      tierName: BROKER_TIERS[this.scoring.tierIndex]!.name,
      tierMul: this.scoring.brokerMultiplier,
      tierProgress: this.scoring.tierProgress,
      cooldown: 1 - this.cooldown / COOLDOWN,
      jarBump: this.jarBump,
      toastText: this.toastText,
      toastT: this.toastT,
    };
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
      const plateY = h * 0.26 - plateH / 2;
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

    const a = 0.55 + 0.45 * Math.sin(this.pulse * 3);
    ctx.globalAlpha = a;
    ctx.fillStyle = colors.rebateGold;
    ctx.font = `${fonts.weight.semibold} ${Math.min(w * 0.05, 20)}px ${fonts.family}`;
    ctx.fillText('Tap to start', cx, h * 0.62);
    ctx.globalAlpha = 1;
  }

  private renderMuteButton(): void {
    const { ctx } = this.vp;
    const r = this.muteRect();
    ctx.fillStyle = 'rgba(23,31,58,0.7)';
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.semibold} 11px ${fonts.family}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('SFX', r.x + 9, r.y + r.h / 2);
    ctx.fillStyle = this.muted ? 'rgba(138,148,166,0.5)' : colors.rebateGold;
    ctx.beginPath();
    ctx.arc(r.x + r.w - 12, r.y + r.h / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.textBaseline = 'alphabetic';
  }

  private renderGameOver(): void {
    const { ctx, w, h } = this.vp;

    ctx.fillStyle = 'rgba(16,24,48,0.84)';
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.black} ${Math.min(w * 0.08, 34)}px ${fonts.family}`;
    ctx.fillText('Run over', cx, h * 0.3);

    // The payoff: P&L (volatile, maybe red) beside Rebate (always positive gold).
    const colY = h * 0.42;
    const lx = w * 0.3;
    const rx = w * 0.7;

    ctx.font = `${fonts.weight.semibold} 13px ${fonts.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText('P&L this run', lx, colY);
    ctx.fillText('Rebate banked', rx, colY);

    const pnlPositive = this.finalPnl >= 0;
    ctx.fillStyle = pnlPositive ? colors.up : colors.down;
    ctx.font = `${fonts.weight.black} ${Math.min(w * 0.07, 30)}px ${fonts.family}`;
    ctx.fillText(
      `${pnlPositive ? '+' : '-'}$${Math.abs(Math.round(this.finalPnl)).toLocaleString('en-US')}`,
      lx,
      colY + 34,
    );

    ctx.fillStyle = colors.rebateGold;
    ctx.fillText(`+${Math.round(this.finalRebate).toLocaleString('en-US')}`, rx, colY + 34);

    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.bold} ${Math.min(w * 0.05, 19)}px ${fonts.family}`;
    ctx.fillText('Win or lose, the rebate pays.', cx, h * 0.6);

    const a = 0.55 + 0.45 * Math.sin(this.pulse * 3);
    ctx.globalAlpha = a;
    ctx.fillStyle = colors.rebateGold;
    ctx.font = `${fonts.weight.semibold} 16px ${fonts.family}`;
    ctx.fillText('Tap to play again', cx, h * 0.7);
    ctx.globalAlpha = 1;
  }
}
