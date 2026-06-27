import type { Viewport } from '../engine/Viewport';
import type { Input } from '../engine/Input';
import type { Audio } from '../engine/Audio';
import type { Particles } from '../engine/Particles';
import type { LeaderEntry, TelegramAdapter } from '../telegram/TelegramAdapter';
import type { Mode, Screen } from './types';
import { Title } from '../ui/Title';
import { type Button, drawButton, hitButton } from '../ui/Button';
import { roundRectPath } from '../ui/glass';
import { colors, fonts } from '../brand/tokens';
import { COPY } from '../brand/copy';
import { wrapText } from '../ui/text';

/**
 * Pivot scaffold orchestrator (Phase 1).
 *
 * Keeps the same constructor signature (engine pieces + adapter) and the polished
 * background, hosts the re-skinned duel Title, and routes the three modes. The
 * round / match-result screens are stubbed ("soon") and filled in over Phases 3–5;
 * the leaderboard panel is reused. Engine stays Telegram-free — only the adapter
 * touches the platform.
 */
export class Game {
  private screen: Screen = 'title';
  private mode: Mode = 'practice';
  private readonly title = new Title();

  private bgScroll = 0;
  private pulse = 0;

  private leaderboard: LeaderEntry[] = [];
  private leaderboardLoading = false;

  constructor(
    private readonly vp: Viewport,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly particles: Particles,
    private readonly adapter: TelegramAdapter,
  ) {}

  update(dt: number): void {
    this.pulse += dt;
    this.bgScroll += dt * 16;
    if (this.input.consumeFire()) this.onTap();
    this.particles.update(dt);
  }

  private onTap(): void {
    const px = this.input.pointerX;
    const py = this.input.pointerY;

    if (this.screen === 'title') {
      const id = hitButton(this.title.buttons(this.vp), px, py);
      if (!id) return;
      this.audio.coin();
      if (id === 'challenge') {
        this.mode = 'challenge';
        this.screen = 'soon';
      } else if (id === 'practice') {
        this.mode = 'practice';
        this.screen = 'soon';
      } else if (id === 'leaderboard') {
        this.enterLeaderboard();
      }
      return;
    }

    if (hitButton(this.backButtons(), px, py) === 'back') {
      this.audio.coin();
      this.screen = 'title';
    }
  }

  private enterLeaderboard(): void {
    this.screen = 'leaderboard';
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

  private backButtons(): Button[] {
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

    if (this.screen === 'title') this.title.render(ctx, this.vp, this.pulse);
    else if (this.screen === 'soon') this.renderSoon();
    else if (this.screen === 'leaderboard') this.renderLeaderboard();

    this.particles.render(ctx);
  }

  private renderBackground(): void {
    const { ctx, w, h } = this.vp;
    const glow = ctx.createRadialGradient(w * 0.5, h * 1.05, 10, w * 0.5, h * 1.05, h * 0.75);
    glow.addColorStop(0, 'rgba(20,42,96,0.5)');
    glow.addColorStop(1, 'rgba(16,24,48,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

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

  private renderSoon(): void {
    const { ctx, w, h } = this.vp;
    const cx = w / 2;
    const label = this.mode === 'challenge' ? COPY.challenge : COPY.practice;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.semibold} 13px ${fonts.family}`;
    ctx.fillText(COPY.soonTitle.toUpperCase(), cx, h * 0.4);

    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.bold} ${Math.min(w * 0.06, 24)}px ${fonts.family}`;
    ctx.fillText(label, cx, h * 0.46);

    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.medium} 14px ${fonts.family}`;
    wrapText(ctx, COPY.soonBody(label), Math.min(w * 0.8, 340)).forEach((ln, i) =>
      ctx.fillText(ln, cx, h * 0.52 + i * 20),
    );

    for (const b of this.backButtons()) drawButton(ctx, b);
    ctx.textAlign = 'left';
  }

  private renderLeaderboard(): void {
    const { ctx, w, h } = this.vp;
    const cx = w / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.black} ${Math.min(w * 0.07, 28)}px ${fonts.family}`;
    ctx.fillText(COPY.leaderboard, cx, h * 0.14);

    const listX = w * 0.12;
    const listW = w * 0.76;
    let y = h * 0.22;
    const rowH = 42;

    if (this.leaderboardLoading || this.leaderboard.length === 0) {
      ctx.fillStyle = colors.textMuted;
      ctx.font = `${fonts.weight.medium} 14px ${fonts.family}`;
      ctx.fillText(this.leaderboardLoading ? 'Loading…' : 'No scores yet.', cx, y + 30);
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

    for (const b of this.backButtons()) drawButton(ctx, b);
    ctx.textAlign = 'left';
  }
}
