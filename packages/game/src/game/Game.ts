import type { Viewport } from '../engine/Viewport';
import type { Input } from '../engine/Input';
import type { Audio } from '../engine/Audio';
import type { Particles } from '../engine/Particles';
import { Rng } from '../engine/Rng';
import type { LeaderEntry, TelegramAdapter } from '../telegram/TelegramAdapter';
import type { Mode, Screen } from './types';
import { CONFIG } from './config';
import { PuzzleBank } from './PuzzleBank';
import { Match } from './Match';
import type { Round } from './Round';
import { type Challenge, challengeUrl, decodeChallenge, makeSeed } from './Challenge';
import { DEFAULT_LEVEL, LEVELS, type Level, levelById } from './levels';
import { accuracyPct } from './scoring';
import { Title } from '../ui/Title';
import { RoundView } from '../ui/RoundView';
import { type Button, drawButton, hitButton } from '../ui/Button';
import { roundRectPath } from '../ui/glass';
import { colors, fonts } from '../brand/tokens';
import { COPY, SIGNUP_URL } from '../brand/copy';
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

  // Reveal juice + cosmetic combo (SPEC §4.5 / §5).
  private combo = 0;
  private bestCombo = 0;
  private shake = 0;
  private verdictFired = false;
  private lastRoundIndex = -1;

  private leaderboard: LeaderEntry[] = [];
  private leaderboardLoading = false;

  // Async duel (SPEC §4): the seed both players share + the incoming challenger.
  private matchSeed = 0;
  private opponent: Challenge | null = null;

  // Difficulty level (SPEC §5): chosen before a match; weights the score.
  private level: Level = DEFAULT_LEVEL;
  private pendingMode: Mode = 'practice';

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
    this.shake = Math.max(0, this.shake - dt);
    if (this.input.consumeFire()) this.onTap();
    this.particles.update(dt);

    if (this.screen === 'round' && this.match) {
      const r = this.match.round;
      if (r.index !== this.lastRoundIndex) {
        this.lastRoundIndex = r.index;
        this.verdictFired = false;
      }
      r.update(dt);
      this.roundView.update(dt, r);
      // Fire the reveal juice exactly once, when the verdict becomes visible.
      if (!this.verdictFired && r.verdictShown) {
        this.verdictFired = true;
        this.onVerdict(r);
      }
    }
  }

  /** Reveal flair: gold/green burst + win SFX on ✓; shake + loss SFX on ✗. */
  private onVerdict(r: Round): void {
    const { w, h } = this.vp;
    if (r.correct) {
      this.combo++;
      if (this.combo > this.bestCombo) this.bestCombo = this.combo;
      this.audio.win();
      this.adapter.haptic('success');
      this.particles.burst(w / 2, h * 0.64, {
        color: [22, 199, 132],
        count: 18,
        speed: [90, 280],
        life: [0.5, 0.95],
        size: [2, 4.5],
        gravity: 430,
        spread: [-Math.PI * 0.85, -Math.PI * 0.15],
      });
      this.particles.burst(w / 2, h * 0.64, {
        color: [245, 196, 81],
        count: 10,
        speed: [60, 210],
        life: [0.5, 0.9],
        size: [2, 4],
        gravity: 380,
        spread: [-Math.PI * 0.9, -Math.PI * 0.1],
      });
    } else {
      this.combo = 0;
      this.audio.loss();
      this.adapter.haptic('warning');
      this.shake = 0.4;
    }
  }

  // ---- lifecycle ---------------------------------------------------------
  /** Resolve an incoming challenge deep-link. Call once after the adapter is ready. */
  handleStartParam(): void {
    this.opponent = decodeChallenge(this.adapter.getStartParam());
    if (this.opponent) {
      this.mode = 'challenge';
      this.level = levelById(this.opponent.level); // play the challenger's level
    }
  }

  private startMatch(mode: Mode, level: Level): void {
    this.mode = mode;
    this.level = level;
    // Challenge mode replays the opponent's seed + level (same puzzles); else fresh.
    this.matchSeed = mode === 'challenge' && this.opponent ? this.opponent.seed : makeSeed();
    this.match = new Match(this.bank.pick(CONFIG.ROUNDS, new Rng(this.matchSeed), level.difficulty));
    this.roundView.reset();
    this.combo = 0;
    this.bestCombo = 0;
    this.shake = 0;
    this.verdictFired = false;
    this.lastRoundIndex = -1;
    this.screen = 'round';
  }

  private finishMatch(): void {
    // Leaderboard score is difficulty-weighted: a correct call is worth more on a
    // harder level (SPEC §5), so the global board rewards skill and spreads out.
    if (this.match) void this.adapter.submitScore(this.match.correctCount * this.level.weight);
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
      case 'levelSelect':
        this.onTapLevelSelect(px, py);
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
    if (id === 'leaderboard') {
      this.enterLeaderboard();
    } else if (id === 'challenge' || id === 'practice') {
      // An incoming challenge fixes the level (must match the challenger); otherwise
      // let the player pick a level first.
      if (id === 'challenge' && this.opponent) {
        this.startMatch('challenge', this.level);
      } else {
        this.pendingMode = id;
        this.screen = 'levelSelect';
      }
    }
  }

  private onTapLevelSelect(px: number, py: number): void {
    if (hitButton(this.backButtons(), px, py) === 'back') {
      this.audio.coin();
      this.screen = 'title';
      return;
    }
    for (const lv of LEVELS) {
      const r = this.levelCardRect(lv);
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
        this.audio.coin();
        this.startMatch(this.pendingMode, lv);
        return;
      }
    }
  }

  private onTapRound(px: number, py: number): void {
    const m = this.match;
    if (!m) return;
    const r = m.round;

    if (r.phase === 'decide') {
      const ctrl = this.roundView.hitControl(this.vp, px, py);
      if (ctrl) {
        this.roundView.applyControl(ctrl, r);
        this.audio.coin();
        return;
      }
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
    if (id === 'cta') {
      this.adapter.openLink(SIGNUP_URL);
    } else if (id === 'rematch') {
      if (this.mode === 'challenge') this.opponent = null; // a fresh challenge to send
      this.startMatch(this.mode, this.level);
    } else if (id === 'leaderboard') {
      this.enterLeaderboard();
    } else if (id === 'share') {
      this.shareResult();
    } else if (id === 'menu') {
      this.screen = 'title';
    }
  }

  private shareResult(): void {
    const correct = this.match ? this.match.correctCount : 0;
    const total = this.match ? this.match.total : CONFIG.ROUNDS;
    if (this.mode === 'challenge') {
      const me = this.adapter.getUser()?.name ?? 'You';
      this.adapter.share(
        COPY.challengeMsg(correct, total),
        challengeUrl({ seed: this.matchSeed, score: correct, name: me, level: this.level.id }),
      );
    } else {
      this.adapter.share();
    }
  }

  // ---- button layouts ----------------------------------------------------
  private backButtons(): Button[] {
    const { w, h } = this.vp;
    const bw = Math.min(w * 0.5, 220);
    const bh = 48;
    return [{ id: 'back', x: w / 2 - bw / 2, y: h * 0.86, w: bw, h: bh, label: COPY.back, kind: 'gold' }];
  }

  private levelCardRect(level: Level): { x: number; y: number; w: number; h: number } {
    const { w, h } = this.vp;
    const cw = Math.min(w * 0.84, 360);
    const ch = 84;
    const gap = 16;
    const idx = LEVELS.indexOf(level);
    const startY = h * 0.3;
    return { x: w / 2 - cw / 2, y: startY + idx * (ch + gap), w: cw, h: ch };
  }

  private resultButtons(): Button[] {
    const { w, h } = this.vp;
    const bw = Math.min(w * 0.82, 360);
    const bx = w / 2 - bw / 2;
    const bh = 50;
    const gap = 11;
    let y = h * 0.52;
    const out: Button[] = [];
    // Top-left menu (back to title).
    out.push({ id: 'menu', x: 14, y: h * 0.035, w: 96, h: 36, label: `‹ ${COPY.menu}`, kind: 'ghost' });
    // The funnel CTA first (the goal), then rematch, then a leaderboard / share row.
    out.push({ id: 'cta', x: bx, y, w: bw, h: bh, label: COPY.cta, kind: 'primary' });
    y += bh + gap;
    const replayLabel = this.mode === 'challenge' ? COPY.rematch : COPY.playAgain;
    out.push({ id: 'rematch', x: bx, y, w: bw, h: bh, label: replayLabel, kind: 'gold' });
    y += bh + gap;
    const half = (bw - gap) / 2;
    out.push({ id: 'leaderboard', x: bx, y, w: half, h: bh, label: COPY.leaderboard, kind: 'ghost' });
    out.push({ id: 'share', x: bx + half + gap, y, w: half, h: bh, label: COPY.share, kind: 'ghost' });
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
    else if (this.screen === 'levelSelect') this.renderLevelSelect();
    else if (this.screen === 'round' && this.match) {
      ctx.save();
      if (this.shake > 0) {
        const m = 7 * this.shake;
        ctx.translate((Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m);
      }
      this.roundView.render(ctx, this.vp, this.match.round, this.match.statuses(), this.combo, this.level);
      ctx.restore();
    } else if (this.screen === 'result') this.renderResult();
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

  private renderLevelSelect(): void {
    const { ctx, w, h } = this.vp;
    const cx = w / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.black} ${Math.min(w * 0.075, 30)}px ${fonts.family}`;
    ctx.fillText(COPY.chooseLevel, cx, h * 0.2);
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.medium} 13px ${fonts.family}`;
    ctx.fillText(COPY.chooseLevelHint, cx, h * 0.2 + 24);

    for (const lv of LEVELS) {
      const r = this.levelCardRect(lv);
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 16);
      ctx.fillStyle = 'rgba(23,31,58,0.7)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = colors.border;
      ctx.stroke();
      // Left accent bar in the level color.
      ctx.save();
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 16);
      ctx.clip();
      ctx.fillStyle = lv.color;
      ctx.fillRect(r.x, r.y, 5, r.h);
      ctx.restore();

      const px = r.x + 22;
      ctx.textAlign = 'left';
      ctx.fillStyle = lv.color;
      ctx.font = `${fonts.weight.black} 22px ${fonts.family}`;
      ctx.fillText(lv.name, px, r.y + 34);
      ctx.fillStyle = colors.textMuted;
      ctx.font = `${fonts.weight.medium} 13px ${fonts.family}`;
      ctx.fillText(lv.tagline, px, r.y + 57);

      // Difficulty dots (filled = level weight) bottom-right.
      const dotsY = r.y + r.h - 18;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(r.x + r.w - 22 - (2 - i) * 14, dotsY, 4, 0, Math.PI * 2);
        ctx.fillStyle = i < lv.weight ? lv.color : 'rgba(138,148,166,0.3)';
        ctx.fill();
      }
      // Points-per-correct badge top-right.
      ctx.textAlign = 'right';
      ctx.fillStyle = colors.rebateGold;
      ctx.font = `${fonts.weight.bold} 13px ${fonts.family}`;
      ctx.fillText(COPY.ptsPerCorrect(lv.weight), r.x + r.w - 18, r.y + 30);
    }

    for (const b of this.backButtons()) drawButton(ctx, b);
    ctx.textAlign = 'left';
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
    ctx.fillText(COPY.matchResult.toUpperCase(), cx, h * 0.16);

    // Level badge (which difficulty this run was).
    ctx.fillStyle = this.level.color;
    ctx.font = `${fonts.weight.bold} 14px ${fonts.family}`;
    ctx.fillText(`${this.level.name.toUpperCase()} · ${this.level.weight}× pts`, cx, h * 0.16 + 22);

    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.black} ${Math.min(w * 0.2, 84)}px ${fonts.family}`;
    ctx.fillText(`${correct}/${total}`, cx, h * 0.3);

    if (this.mode === 'challenge') {
      this.renderDuelLine(correct, total, h, cx);
    } else {
      ctx.fillStyle = colors.rebateGold;
      ctx.font = `${fonts.weight.bold} 16px ${fonts.family}`;
      const streak = this.bestCombo >= 2 ? `   ·   ${COPY.bestStreak} ×${this.bestCombo}` : '';
      ctx.fillText(`${accuracyPct(correct, total)}% ${COPY.accuracyLabel}${streak}`, cx, h * 0.36);
    }

    ctx.fillStyle = 'rgba(245,196,81,0.9)';
    ctx.font = `${fonts.weight.medium} 13px ${fonts.family}`;
    ctx.textAlign = 'center';
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

  /** The duel head-to-head (incoming challenge) or the share prompt (outgoing). */
  private renderDuelLine(correct: number, total: number, h: number, cx: number): void {
    const { ctx } = this.vp;
    ctx.textAlign = 'center';
    if (this.opponent) {
      const opp = this.opponent.score;
      ctx.fillStyle = colors.text;
      ctx.font = `${fonts.weight.bold} 15px ${fonts.family}`;
      ctx.fillText(`${COPY.you} ${correct}/${total}   ${COPY.vs}   ${this.opponent.name} ${opp}/${total}`, cx, h * 0.36);
      const win = correct > opp;
      const lose = correct < opp;
      ctx.fillStyle = win ? colors.up : lose ? colors.down : colors.textMuted;
      ctx.font = `${fonts.weight.black} 20px ${fonts.family}`;
      ctx.fillText(win ? COPY.youWin : lose ? COPY.youLose : COPY.tie, cx, h * 0.41);
    } else {
      ctx.fillStyle = colors.rebateGold;
      ctx.font = `${fonts.weight.semibold} 13px ${fonts.family}`;
      ctx.fillText(COPY.shareToChallenge, cx, h * 0.38);
    }
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
