import type { Viewport } from '../engine/Viewport';
import type { Input } from '../engine/Input';
import type { Audio } from '../engine/Audio';
import type { Particles } from '../engine/Particles';
import type { Rng } from '../engine/Rng';
import type { LeaderEntry, TelegramAdapter } from '../telegram/TelegramAdapter';
import type { Mode, Screen } from './types';
import { CONFIG } from './config';
import { PuzzleBank } from './PuzzleBank';
import { Match } from './Match';
import { accuracyPct } from './scoring';
import { Title } from '../ui/Title';
import { RoundView } from '../ui/RoundView';
import { type Button, drawButton, hitButton } from '../ui/Button';
import { roundRectPath } from '../ui/glass';
import { colors, fonts } from '../brand/tokens';
import { COPY } from '../brand/copy';
import { wrapText } from '../ui/text';

/**
 * The duel orchestrator. Owns the screen router (title → round → result →
 * leaderboard) and wires input, the match/round logic, and the views together.
 * Stays Telegram-agnostic — it only ever talks to the injected adapter (haptics,
 * score submission, share, the sign-up CTA).
 */
export class Game {
  private screen: Screen = 'title';
  private mode: Mode = 'practice';
  private readonly title = new Title();
  private readonly bank = new PuzzleBank();
  private readonly roundView = new RoundView();
  private match: Match | null = null;

  private bgScroll = 0;
  private pulse = 0;

  private leaderboard: LeaderEntry[] = [];
  private leaderboardLoading = false;

  constructor(
    private readonly vp: Viewport,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly particles: Particles,
    private readonly rng: Rng,
    private readonly adapter: TelegramAdapter,
  ) {}

  update(dt: number): void {
    this.pulse += dt;
    this.bgScroll += dt * 16;
    if (this.input.consumeFire()) this.onTap();
    this.particles.update(dt);

    if (this.screen === 'round' && this.match) {
      const r = this.match.round;
      r.update(dt);
      this.roundView.update(dt, r);
    }
  }

  // ---- lifecycle ---------------------------------------------------------
  private startMatch(mode: Mode): void {
    this.mode = mode;
    this.match = new Match(this.bank.pick(CONFIG.ROUNDS, this.rng));
    this.roundView.reset();
    this.screen = 'round';
  }

  private finishMatch(): void {
    if (this.match) void this.adapter.submitScore(this.match.correctCount);
    this.screen = 'result';
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

  // ---- input -------------------------------------------------------------
  private onTap(): void {
    const px = this.input.pointerX;
    const py = this.input.pointerY;

    switch (this.screen) {
      case 'title':
        this.onTapTitle(px, py);
        break;
      case 'round':
        this.onTapRound(px, py);
        break;
      case 'result':
        this.onTapResult(px, py);
        break;
      case 'leaderboard':
        if (hitButton(this.backButtons(), px, py) === 'back') {
          this.audio.coin();
          this.screen = 'title';
        }
        break;
    }
  }

  private onTapTitle(px: number, py: number): void {
    const id = hitButton(this.title.buttons(this.vp), px, py);
    if (!id) return;
    this.audio.coin();
    if (id === 'challenge') this.startMatch('challenge');
    else if (id === 'practice') this.startMatch('practice');
    else if (id === 'leaderboard') this.enterLeaderboard();
  }

  private onTapRound(px: number, py: number): void {
    const m = this.match;
    if (!m) return;
    const r = m.round;

    if (r.phase === 'decide') {
      const inside = (rect: { x: number; y: number; w: number; h: number }): boolean =>
        px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
      if (inside(this.roundView.buyRect(this.vp))) this.lockCall('up');
      else if (inside(this.roundView.sellRect(this.vp))) this.lockCall('down');
      return;
    }

    if (r.phase === 'reveal' || r.phase === 'done') {
      if (this.roundView.hitVerify(px, py)) {
        this.roundView.toggleVerify();
        this.audio.coin();
        return;
      }
      if (r.phase === 'done') {
        const b = this.roundView.continueButton(this.vp, m.isLast);
        if (hitButton([b], px, py) === 'continue') {
          this.audio.coin();
          if (m.isLast) this.finishMatch();
          else {
            m.advance();
            this.roundView.reset();
          }
        }
      }
    }
  }

  private lockCall(call: 'up' | 'down'): void {
    this.match!.round.lockIn(call);
    this.audio.coin();
    this.adapter.haptic('impact');
  }

  private onTapResult(px: number, py: number): void {
    const id = hitButton(this.resultButtons(), px, py);
    if (!id) return;
    this.audio.coin();
    if (id === 'replay') this.startMatch(this.mode);
    else if (id === 'leaderboard') this.enterLeaderboard();
    else if (id === 'back') this.screen = 'title';
  }

  // ---- button layouts ----------------------------------------------------
  private backButtons(): Button[] {
    const { w, h } = this.vp;
    const bw = Math.min(w * 0.5, 220);
    const bh = 48;
    return [{ id: 'back', x: w / 2 - bw / 2, y: h * 0.86, w: bw, h: bh, label: COPY.back, kind: 'gold' }];
  }

  private resultButtons(): Button[] {
    const { w, h } = this.vp;
    const bw = Math.min(w * 0.72, 300);
    const bx = w / 2 - bw / 2;
    const bh = 52;
    const gap = 12;
    let y = h * 0.6;
    const out: Button[] = [];
    const add = (id: string, label: string, kind: Button['kind']): void => {
      out.push({ id, x: bx, y, w: bw, h: bh, label, kind });
      y += bh + gap;
    };
    add('replay', COPY.playAgain, 'gold');
    add('leaderboard', COPY.leaderboard, 'ghost');
    add('back', COPY.back, 'ghost');
    return out;
  }

  // ---- render ------------------------------------------------------------
  render(_alpha: number): void {
    const { ctx, w, h } = this.vp;
    this.vp.begin();
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);
    this.renderBackground();

    if (this.screen === 'title') this.title.render(ctx, this.vp, this.pulse);
    else if (this.screen === 'round' && this.match)
      this.roundView.render(ctx, this.vp, this.match.round, this.match.statuses());
    else if (this.screen === 'result') this.renderResult();
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

  private renderResult(): void {
    const { ctx, w, h } = this.vp;
    const cx = w / 2;
    const m = this.match;
    const correct = m ? m.correctCount : 0;
    const total = m ? m.total : CONFIG.ROUNDS;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.semibold} 13px ${fonts.family}`;
    ctx.fillText(COPY.matchResult.toUpperCase(), cx, h * 0.2);

    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.black} ${Math.min(w * 0.2, 84)}px ${fonts.family}`;
    ctx.fillText(`${correct}/${total}`, cx, h * 0.34);

    ctx.fillStyle = colors.rebateGold;
    ctx.font = `${fonts.weight.bold} 16px ${fonts.family}`;
    ctx.fillText(`${accuracyPct(correct, total)}% ${COPY.accuracyLabel}`, cx, h * 0.4);

    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.medium} 13px ${fonts.family}`;
    wrapText(ctx, COPY.rebateReminder, Math.min(w * 0.82, 340)).forEach((ln, i) =>
      ctx.fillText(ln, cx, h * 0.47 + i * 18),
    );

    for (const b of this.resultButtons()) drawButton(ctx, b);

    ctx.fillStyle = 'rgba(138,148,166,0.7)';
    ctx.font = `${fonts.weight.medium} 10px ${fonts.family}`;
    wrapText(ctx, COPY.pointsDisclaimer, Math.min(w * 0.86, 360)).forEach((ln, i) =>
      ctx.fillText(ln, cx, h * 0.955 + i * 13),
    );
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
