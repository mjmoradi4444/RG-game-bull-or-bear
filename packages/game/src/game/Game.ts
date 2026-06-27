import type { Viewport } from '../engine/Viewport';
import type { Input } from '../engine/Input';
import type { Audio } from '../engine/Audio';
import type { Particles } from '../engine/Particles';
import type { Rng } from '../engine/Rng';
import type { LeaderEntry, TelegramAdapter } from '../telegram/TelegramAdapter';
import type { GameState } from './types';
import { Scoring } from './Scoring';
import { Difficulty } from './Difficulty';
import { World } from './World';
import { FlyingCoins } from './FlyingCoins';
import { BROKER_TIERS } from './Brokers';
import { Hud, type HudState } from '../ui/Hud';
import { drawGlassPanel, roundRectPath } from '../ui/glass';
import { type Button, drawButton, hitButton } from '../ui/Button';
import { wrapText } from '../ui/text';
import { COPY, SIGNUP_URL } from '../brand/copy';
import { colors, fonts } from '../brand/tokens';
import { damp } from '../engine/math';

const MAX_LIVES = 3;
const COOLDOWN = 0.35;
const TOAST_SECONDS = 2.4;

/**
 * The game orchestrator. Owns the state machine (title → playing → gameover →
 * leaderboard) and ties input, the world, scoring, lives, particles, coins and the
 * HUD into one update/render pair. Stays Telegram-agnostic — it only ever talks to
 * the injected TelegramAdapter (haptics, score submission, share, the sign-up CTA).
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
  private gameoverLock = 0;

  private dispRebate = 0;
  private dispPnl = 0;
  private pnlFlash = 0;
  private jarBump = 0;
  private shake = 0;
  private bgScroll = 0;

  private toastText: string | null = null;
  private toastT = 0;

  private finalRebate = 0;
  private finalPnl = 0;

  private leaderboard: LeaderEntry[] = [];
  private leaderboardLoading = false;

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

  private enterLeaderboard(): void {
    this.state = 'leaderboard';
    this.leaderboardLoading = true;
    this.leaderboard = [];
    this.adapter
      .getLeaderboard()
      .then((rows) => {
        this.leaderboard = rows;
        this.leaderboardLoading = false;
      })
      .catch(() => {
        this.leaderboardLoading = false;
      });
  }

  // ---- update ------------------------------------------------------------

  update(dt: number): void {
    this.pulse += dt;
    this.bgScroll += dt * 16;

    if (this.input.consumeFire()) this.onTap();

    if (this.state === 'playing') {
      this.difficulty.update(dt);
      this.world.update(dt);
      this.cooldown = Math.max(0, this.cooldown - dt);
    }
    this.gameoverLock = Math.max(0, this.gameoverLock - dt);

    this.coins.update(dt, (x, y) => this.onCoinArrive(x, y));
    this.particles.update(dt);

    this.dispRebate = damp(this.dispRebate, this.scoring.rebate, 14, dt);
    this.dispPnl = damp(this.dispPnl, this.scoring.pnl, 11, dt);

    this.pnlFlash = Math.max(0, this.pnlFlash - dt * 2.6);
    this.jarBump = Math.max(0, this.jarBump - dt * 3);
    this.shake = Math.max(0, this.shake - dt);
    if (this.toastT > 0) this.toastT = Math.max(0, this.toastT - dt / TOAST_SECONDS);
  }

  private onTap(): void {
    const px = this.input.pointerX;
    const py = this.input.pointerY;

    if (this.state === 'title') {
      this.startRun();
      return;
    }
    if (this.state === 'gameover') {
      if (this.gameoverLock > 0) return;
      const id = hitButton(this.gameOverButtons(), px, py);
      if (id) this.doAction(id);
      return;
    }
    if (this.state === 'leaderboard') {
      const id = hitButton(this.leaderboardButtons(), px, py);
      if (id) this.doAction(id);
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

    if (res.outcome === 'win') {
      this.audio.win();
      this.adapter.haptic('success');
    } else {
      this.audio.loss();
      this.adapter.haptic('impact');
      this.pnlFlash = 1;
      this.shake = Math.max(this.shake, 0.18);
    }

    // The teaching moment — the rebate always pays, every trade.
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

    if (res.highSpread) {
      this.lives--;
      this.scoring.breakCombo();
      this.adapter.haptic('warning');
      this.shake = Math.max(this.shake, 0.35);
      this.showToast(COPY.highSpreadHit);
      if (this.lives <= 0) {
        this.gameOver();
        return;
      }
    }

    if (tr.unlockedTierIndex !== null) {
      const t = BROKER_TIERS[tr.unlockedTierIndex]!;
      this.showToast(COPY.brokerUnlock(t.name, t.multiplier));
      this.adapter.haptic('success');
    }
  }

  private doAction(id: string): void {
    switch (id) {
      case 'replay':
        this.startRun();
        break;
      case 'leaderboard':
        this.enterLeaderboard();
        break;
      case 'share':
        this.adapter.share();
        break;
      case 'cta':
        this.adapter.openLink(SIGNUP_URL);
        break;
      case 'back':
        this.state = 'gameover';
        break;
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

  private muteRect(): { x: number; y: number; w: number; h: number } {
    return { x: 12, y: this.vp.h - 46, w: 56, h: 30 };
  }

  private hitMuteButton(): boolean {
    const r = this.muteRect();
    const px = this.input.pointerX;
    const py = this.input.pointerY;
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  // ---- button layouts (shared by render + hit-test) ----------------------

  private gameOverButtons(): Button[] {
    const { w, h } = this.vp;
    const bw = Math.min(w * 0.86, 360);
    const bx = w / 2 - bw / 2;
    const bh = 50;
    const gap = 12;
    let y = h * 0.6;
    const cta: Button = { id: 'cta', x: bx, y, w: bw, h: bh, label: COPY.cta, kind: 'primary' };
    y += bh + gap;
    const again: Button = { id: 'replay', x: bx, y, w: bw, h: bh, label: COPY.playAgain, kind: 'gold' };
    y += bh + gap;
    const half = (bw - gap) / 2;
    const lb: Button = { id: 'leaderboard', x: bx, y, w: half, h: bh, label: COPY.leaderboard, kind: 'ghost' };
    const sh: Button = { id: 'share', x: bx + half + gap, y, w: half, h: bh, label: COPY.share, kind: 'ghost' };
    return [cta, again, lb, sh];
  }

  private leaderboardButtons(): Button[] {
    const { w, h } = this.vp;
    const bw = Math.min(w * 0.5, 220);
    const bh = 48;
    return [{ id: 'back', x: w / 2 - bw / 2, y: h * 0.86, w: bw, h: bh, label: COPY.back, kind: 'gold' }];
  }

  // ---- render ------------------------------------------------------------

  render(_alpha: number): void {
    const { ctx, w, h } = this.vp;
    this.vp.begin();
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);
    this.renderBackground();

    if (this.state === 'title') {
      this.renderTitle();
      this.particles.render(ctx);
      return;
    }

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

    if (this.state === 'playing') this.renderMuteButton();
    if (this.state === 'gameover') this.renderGameOver();
    if (this.state === 'leaderboard') this.renderLeaderboard();
  }

  private renderBackground(): void {
    const { ctx, w, h } = this.vp;

    // Ambient brand-blue glow rising from the bottom.
    const glow = ctx.createRadialGradient(w * 0.5, h * 1.05, 10, w * 0.5, h * 1.05, h * 0.75);
    glow.addColorStop(0, 'rgba(20,42,96,0.5)');
    glow.addColorStop(1, 'rgba(16,24,48,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // Faint chart grid — horizontal fixed, vertical parallax-scrolls.
    ctx.strokeStyle = 'rgba(40,49,84,0.25)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const y = h * (i / 6);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    const spacing = 84;
    const off = this.bgScroll % spacing;
    ctx.strokeStyle = 'rgba(40,49,84,0.16)';
    for (let x = -off; x < w; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
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

  private drawLogoPlate(cx: number, topY: number, maxW: number): number {
    const { ctx } = this.vp;
    if (!this.lockupReady) return topY;
    const lw = Math.min(maxW, 280);
    const lh = lw * (this.lockup.height / this.lockup.width);
    const pad = Math.max(14, lw * 0.085);
    const pw = lw + pad * 2;
    const ph = lh + pad * 2;
    drawGlassPanel(ctx, cx - pw / 2, topY, pw, ph, Math.min(26, ph * 0.22));
    ctx.drawImage(this.lockup, cx - lw / 2, topY + pad, lw, lh);
    return topY + ph;
  }

  private renderTitle(): void {
    const { ctx, w, h } = this.vp;
    const cx = w / 2;

    this.drawLogoPlate(cx, h * 0.16, w * 0.5);

    // Bobbing rebate coin.
    const coinY = h * 0.37 + Math.sin(this.pulse * 2) * 5;
    const cr = Math.min(w * 0.05, 20);
    const g = ctx.createRadialGradient(cx - 3, coinY - 3, 2, cx, coinY, cr);
    g.addColorStop(0, colors.rebateGoldLight);
    g.addColorStop(1, colors.rebateGold);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, coinY, cr, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.black} ${Math.min(w * 0.11, 48)}px ${fonts.family}`;
    ctx.fillText(COPY.title, cx, h * 0.52);

    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.medium} ${Math.min(w * 0.042, 18)}px ${fonts.family}`;
    ctx.fillText(COPY.tagline, cx, h * 0.52 + 32);

    const a = 0.55 + 0.45 * Math.sin(this.pulse * 3);
    ctx.globalAlpha = a;
    ctx.fillStyle = colors.rebateGold;
    ctx.font = `${fonts.weight.semibold} ${Math.min(w * 0.05, 20)}px ${fonts.family}`;
    ctx.fillText(COPY.tapToStart, cx, h * 0.66);
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(138,148,166,0.8)';
    ctx.font = `${fonts.weight.medium} 12px ${fonts.family}`;
    ctx.fillText(COPY.startHint, cx, h * 0.72);
  }

  private renderMuteButton(): void {
    const { ctx } = this.vp;
    const r = this.muteRect();
    ctx.fillStyle = 'rgba(23,31,58,0.7)';
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 8);
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
    ctx.fillStyle = 'rgba(16,24,48,0.9)';
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;

    const plateBottom = this.drawLogoPlate(cx, h * 0.05, Math.min(w * 0.42, 200));

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.black} ${Math.min(w * 0.072, 30)}px ${fonts.family}`;
    // Flow the title below the plate so it never overlaps on wide (desktop) webviews.
    ctx.fillText(COPY.gameOverTitle, cx, Math.max(h * 0.27, plateBottom + 30));

    // The payoff: P&L (volatile, maybe red) beside Rebate (always positive gold).
    const colY = h * 0.33;
    const lx = w * 0.3;
    const rx = w * 0.7;
    ctx.font = `${fonts.weight.semibold} 13px ${fonts.family}`;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText(COPY.pnlThisRun, lx, colY);
    ctx.fillText(COPY.rebateBanked, rx, colY);

    const pos = this.finalPnl >= 0;
    ctx.font = `${fonts.weight.black} ${Math.min(w * 0.07, 30)}px ${fonts.family}`;
    ctx.fillStyle = pos ? colors.up : colors.down;
    ctx.fillText(
      `${pos ? '+' : '-'}$${Math.abs(Math.round(this.finalPnl)).toLocaleString('en-US')}`,
      lx,
      colY + 34,
    );
    ctx.fillStyle = colors.rebateGold;
    ctx.fillText(`+${Math.round(this.finalRebate).toLocaleString('en-US')}`, rx, colY + 34);

    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.bold} ${Math.min(w * 0.05, 19)}px ${fonts.family}`;
    ctx.fillText(COPY.brandLine, cx, h * 0.46);

    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.medium} 13px ${fonts.family}`;
    const eLines = wrapText(ctx, COPY.explainer, Math.min(w * 0.82, 340));
    eLines.forEach((ln, i) => ctx.fillText(ln, cx, h * 0.46 + 24 + i * 18));

    for (const b of this.gameOverButtons()) drawButton(ctx, b);

    ctx.fillStyle = 'rgba(138,148,166,0.75)';
    ctx.font = `${fonts.weight.medium} 10px ${fonts.family}`;
    ctx.textAlign = 'center';
    const dLines = wrapText(ctx, COPY.scoreDisclaimer, Math.min(w * 0.86, 360));
    dLines.forEach((ln, i) => ctx.fillText(ln, cx, h * 0.955 - (dLines.length - 1 - i) * 13));
    ctx.textAlign = 'left';
  }

  private renderLeaderboard(): void {
    const { ctx, w, h } = this.vp;
    ctx.fillStyle = 'rgba(16,24,48,0.95)';
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.black} ${Math.min(w * 0.07, 28)}px ${fonts.family}`;
    ctx.fillText(COPY.leaderboardTitle, cx, h * 0.14);
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.medium} 13px ${fonts.family}`;
    ctx.fillText(COPY.leaderboardSubtitle, cx, h * 0.14 + 22);

    const listX = w * 0.12;
    const listW = w * 0.76;
    let y = h * 0.24;
    const rowH = 42;

    if (this.leaderboardLoading) {
      ctx.fillStyle = colors.textMuted;
      ctx.fillText(COPY.loading, cx, y + 30);
    } else if (this.leaderboard.length === 0) {
      ctx.fillStyle = colors.textMuted;
      ctx.fillText(COPY.emptyBoard, cx, y + 30);
    } else {
      ctx.textBaseline = 'middle';
      for (const e of this.leaderboard) {
        const self = !!e.isSelf;
        const my = y + (rowH - 6) / 2;
        roundRectPath(ctx, listX, y, listW, rowH - 6, 10);
        ctx.fillStyle = self ? 'rgba(245,196,81,0.13)' : 'rgba(23,31,58,0.7)';
        ctx.fill();
        if (self) {
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(245,196,81,0.5)';
          ctx.stroke();
        }
        ctx.textAlign = 'left';
        ctx.fillStyle = self ? colors.rebateGold : colors.textMuted;
        ctx.font = `${fonts.weight.bold} 14px ${fonts.family}`;
        ctx.fillText(`${e.rank}`, listX + 14, my);
        ctx.fillStyle = colors.text;
        ctx.font = `${fonts.weight.semibold} 14px ${fonts.family}`;
        ctx.fillText(e.name, listX + 42, my);
        ctx.textAlign = 'right';
        ctx.fillStyle = colors.rebateGold;
        ctx.font = `${fonts.weight.bold} 14px ${fonts.family}`;
        ctx.fillText(e.score.toLocaleString('en-US'), listX + listW - 14, my);
        y += rowH;
      }
      ctx.textBaseline = 'alphabetic';
    }

    for (const b of this.leaderboardButtons()) drawButton(ctx, b);
    ctx.textAlign = 'left';
  }
}
