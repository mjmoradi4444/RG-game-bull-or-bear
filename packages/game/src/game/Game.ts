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
import type { Puzzle } from './Puzzle';
import { accuracyPct } from './scoring';
import {
  apiBase,
  launchGctx,
  Multiplayer,
  type MpFinal,
  type MpMatched,
} from '../net/Multiplayer';
import { Title } from '../ui/Title';
import { RoundView } from '../ui/RoundView';
import { type Button, drawButton, hitButton } from '../ui/Button';
import { roundRectPath } from '../ui/glass';
import { colors, fonts } from '../brand/tokens';
import { COPY, SIGNUP_URL } from '../brand/copy';
import { wrapText } from '../ui/text';

/** Seconds the VS face-off holds before the live match starts (tap skips). */
const VS_SECONDS = 3;

function loadAvatar(path: string | null): HTMLImageElement | null {
  if (!path) return null;
  const img = new Image();
  img.src = `${apiBase()}${path}`;
  return img;
}

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
  /** Where the leaderboard was opened from, so Back returns there (result vs title). */
  private leaderboardFrom: Screen = 'title';

  // Async duel (SPEC §4): the seed both players share + the incoming challenger.
  private matchSeed = 0;
  private opponent: Challenge | null = null;

  // Difficulty level (SPEC §5): chosen before a match; weights the score.
  private level: Level = DEFAULT_LEVEL;
  private pendingMode: Mode = 'practice';

  /** Last whole second we ticked for, so the countdown tick fires once per second. */
  private lastTickSec = -1;

  // Live 1-v-1 matchmaking (Multiplayer mode).
  private mp: Multiplayer | null = null;
  private mpMatched: MpMatched | null = null;
  private mpFinal: MpFinal | null = null;
  private mpDropped = false;
  /** True while the current match is a live matched duel (vs the async link flow). */
  private live = false;
  private vsT = 0;
  /** Total decision time this match (ms) — live + async tiebreak. */
  private totalMs = 0;
  /** Sudden-death reserve puzzles (both sides hold the same ones from the seed). */
  private reserve: Puzzle[] = [];
  private avatarYou: HTMLImageElement | null = null;
  private avatarOpp: HTMLImageElement | null = null;

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
    const gesture = this.input.takeGesture(); // drained every tick to avoid buildup
    this.particles.update(dt);

    // VS intro: hold the face-off for a beat, then start the live match.
    if (this.screen === 'vs' && this.mpMatched) {
      this.vsT += dt;
      if (this.vsT >= VS_SECONDS) this.startLiveMatch();
    }

    if (this.screen === 'round' && this.match) {
      const r = this.match.round;
      if (r.index !== this.lastRoundIndex) {
        this.lastRoundIndex = r.index;
        this.verdictFired = false;
      }
      // Pinch/drag/wheel chart navigation during the decision window.
      if (r.phase === 'decide') {
        if (gesture.zoomFactor !== 1) this.roundView.zoomBy(gesture.zoomFactor, r);
        if (gesture.panDx !== 0) this.roundView.panByPixels(gesture.panDx, this.vp, r);
        // Urgency tick over the final seconds (once per second, only pre-lock).
        const sec = Math.ceil(r.decisionLeft);
        if (sec !== this.lastTickSec) {
          this.lastTickSec = sec;
          if (!r.locked && sec <= 3 && sec >= 1) this.audio.tick();
        }
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
    // Decision time for the tiebreaks; a timeout costs the full window.
    const ms = Math.round((CONFIG.DECISION_SECONDS - r.decisionLeft) * 1000);
    this.totalMs += ms;
    // Live duel: report this round to the server (it relays + scores the match).
    if (this.live && this.mp) this.mp.sendRound(r.index + 1, r.correct, ms);
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

  private startMatch(mode: Mode, level: Level, seed?: number): void {
    // The dataset chunk loads in parallel with boot; in the rare case the player
    // outraces it, start the match the moment it lands.
    if (!this.bank.isReady) {
      void this.bank.ready.then(() => this.startMatch(mode, level, seed));
      return;
    }
    this.mode = mode;
    this.level = level;
    // Seed priority: explicit (live match) → async challenger's → fresh.
    this.matchSeed =
      seed ?? (mode === 'challenge' && this.opponent ? this.opponent.seed : makeSeed());
    // Pick extra puzzles beyond the match as the sudden-death reserve — deterministic
    // from the seed, so both sides of a duel hold the identical reserve.
    const picked = this.bank.pick(CONFIG.ROUNDS + 3, new Rng(this.matchSeed), level.difficulty);
    this.match = new Match(picked.slice(0, CONFIG.ROUNDS));
    this.reserve = picked.slice(CONFIG.ROUNDS);
    this.live = seed !== undefined;
    this.totalMs = 0;
    this.roundView.reset();
    this.combo = 0;
    this.bestCombo = 0;
    this.shake = 0;
    this.verdictFired = false;
    this.lastRoundIndex = -1;
    this.screen = 'round';
  }

  // ---- live 1-v-1 matchmaking ---------------------------------------------
  private enterLobby(level: Level): void {
    this.level = level;
    this.mpMatched = null;
    this.mpFinal = null;
    this.mpDropped = false;
    this.avatarYou = null;
    this.avatarOpp = null;
    this.screen = 'lobby';
    this.mp?.dispose();
    this.mp = new Multiplayer({
      onMatched: (m) => this.onMpMatched(m),
      onSudden: () => this.onMpSudden(),
      onFinal: (f) => this.onMpFinal(f),
      onDrop: () => this.onMpDrop(),
    });
    this.mp.queue(level.id, { gctx: launchGctx(), name: this.adapter.getUser()?.name });
  }

  private onMpMatched(m: MpMatched): void {
    this.mpMatched = m;
    this.level = levelById(m.level);
    this.avatarYou = loadAvatar(m.you.avatar);
    this.avatarOpp = loadAvatar(m.opp.avatar);
    this.vsT = 0;
    this.screen = 'vs';
    this.audio.win();
    this.adapter.haptic('success');
  }

  private startLiveMatch(): void {
    if (!this.mpMatched) return;
    this.opponent = null; // live duel, not the async-link flow
    this.startMatch('challenge', levelById(this.mpMatched.level), this.mpMatched.seed);
  }

  /** Tie → the server calls one more round; both sides hold the same reserve. */
  private onMpSudden(): void {
    const m = this.match;
    const extra = this.reserve.shift();
    if (!m || !extra) return;
    m.append(extra);
    this.roundView.reset();
    this.verdictFired = false;
    this.lastRoundIndex = -1;
    this.screen = 'round';
    this.audio.coin();
    this.adapter.haptic('warning');
  }

  private onMpFinal(f: MpFinal): void {
    this.mpFinal = f;
    if (f.winner === 'you') this.audio.win();
    else if (f.winner === 'opp') this.audio.loss();
    // Forfeit can land mid-round — jump to the result; a normal final lands while
    // we're already on (or headed to) the result screen.
    if (f.forfeit) this.screen = 'result';
  }

  private onMpDrop(): void {
    this.mpDropped = true;
    if (this.screen === 'lobby' || this.screen === 'vs') {
      // Couldn't queue / lost the lobby — back to level select.
      this.screen = 'levelSelect';
    }
    // Mid-match: the render shows "connection lost" on the result if no final came.
  }

  private leaveLobby(): void {
    this.mp?.leave();
    this.mp = null;
    this.screen = 'levelSelect';
  }

  private finishMatch(): void {
    // Quick Play feeds the GLOBAL leaderboard (difficulty-weighted: a correct call is
    // worth more on a harder level — SPEC §5). A challenge is a PRIVATE head-to-head
    // between the two friends (compared via the shared link), so it does NOT post to
    // the global board.
    if (this.match && this.mode === 'practice') {
      void this.adapter.submitScore(this.match.correctCount * this.level.weight);
    }
    this.screen = 'result';
  }

  private enterLeaderboard(): void {
    this.leaderboardFrom = this.screen;
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

    // Global SFX toggle (top-right on every screen).
    const mr = this.muteRect();
    if (px >= mr.x && px <= mr.x + mr.w && py >= mr.y && py <= mr.y + mr.h) {
      this.audio.setMuted(!this.audio.isMuted);
      this.audio.coin(); // audible only when unmuting — instant feedback
      return;
    }

    switch (this.screen) {
      case 'title':
        this.onTapTitle(px, py);
        break;
      case 'levelSelect':
        this.onTapLevelSelect(px, py);
        break;
      case 'lobby':
        if (hitButton(this.lobbyButtons(), px, py) === 'cancel') {
          this.audio.coin();
          this.leaveLobby();
        }
        break;
      case 'vs':
        this.startLiveMatch(); // tap skips the intro
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
          // Return to where the board was opened from: after a match that's the
          // result screen (the player's score) — Main Menu lives there.
          this.screen = this.leaderboardFrom === 'result' && this.match ? 'result' : 'title';
        }
        break;
    }
  }

  private onTapTitle(px: number, py: number): void {
    // The small brand-CTA chip (the campaign funnel, kept light).
    const cr = this.title.ctaRect(this.vp);
    if (px >= cr.x && px <= cr.x + cr.w && py >= cr.y && py <= cr.y + cr.h) {
      this.audio.coin();
      this.adapter.openLink(SIGNUP_URL);
      return;
    }
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
        // Multiplayer queues for a live opponent on this level; Quick Play starts.
        if (this.pendingMode === 'challenge') this.enterLobby(lv);
        else this.startMatch(this.pendingMode, lv);
        return;
      }
    }
  }

  private onTapRound(px: number, py: number): void {
    const m = this.match;
    if (!m) return;
    const r = m.round;

    // The intro is deliberately slow — a tap skips straight to the decision.
    if (r.phase === 'preroll' || r.phase === 'playback') {
      r.skipIntro();
      return;
    }

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
    if (id === 'cta') {
      this.adapter.openLink(SIGNUP_URL);
    } else if (id === 'rematch') {
      if (this.live) {
        // Live duel rematch = requeue on the same level for a fresh opponent.
        this.enterLobby(this.level);
        return;
      }
      if (this.mode === 'challenge') this.opponent = null; // a fresh challenge to send
      this.startMatch(this.mode, this.level);
    } else if (id === 'leaderboard') {
      this.enterLeaderboard();
    } else if (id === 'share') {
      this.shareResult();
    } else if (id === 'menu') {
      this.mp?.dispose();
      this.mp = null;
      this.live = false;
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
        challengeUrl({
          seed: this.matchSeed,
          score: correct,
          name: me,
          level: this.level.id,
          timeMs: Math.round(this.totalMs),
        }),
      );
    } else {
      this.adapter.share();
    }
  }

  // ---- button layouts ----------------------------------------------------
  private muteRect(): { x: number; y: number; w: number; h: number } {
    return { x: this.vp.w - 60, y: 12, w: 48, h: 26 };
  }

  private backButtons(): Button[] {
    const { w, h } = this.vp;
    const bw = Math.min(w * 0.5, 220);
    const bh = 48;
    return [{ id: 'back', x: w / 2 - bw / 2, y: h * 0.86, w: bw, h: bh, label: COPY.back, kind: 'gold' }];
  }

  private lobbyButtons(): Button[] {
    const { w, h } = this.vp;
    const bw = Math.min(w * 0.5, 220);
    const bh = 48;
    return [{ id: 'cancel', x: w / 2 - bw / 2, y: h * 0.72, w: bw, h: bh, label: COPY.cancel, kind: 'ghost' }];
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

    if (this.screen === 'title') {
      const banner = this.opponent
        ? COPY.incomingChallenge(this.opponent.name, this.opponent.score, CONFIG.ROUNDS)
        : null;
      this.title.render(ctx, this.vp, this.pulse, banner);
    }
    else if (this.screen === 'levelSelect') this.renderLevelSelect();
    else if (this.screen === 'lobby') this.renderLobby();
    else if (this.screen === 'vs') this.renderVs();
    else if (this.screen === 'round' && this.match) {
      ctx.save();
      if (this.shake > 0) {
        const m = 7 * this.shake;
        ctx.translate((Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m);
      }
      this.roundView.render(ctx, this.vp, this.match.round, this.match.statuses(), this.combo, this.level);
      // Sudden-death banner on tie-break rounds (live duels).
      if (this.live && this.match.round.index >= CONFIG.ROUNDS) {
        ctx.textAlign = 'center';
        ctx.fillStyle = colors.rebateGold;
        ctx.font = `${fonts.weight.black} 13px ${fonts.family}`;
        ctx.fillText(`⚡ ${COPY.suddenDeath} ⚡`, w / 2, h * 0.128 + 16);
      }
      ctx.restore();
    } else if (this.screen === 'result') this.renderResult();
    else if (this.screen === 'leaderboard') this.renderLeaderboard();

    this.particles.render(ctx);
    this.renderMute();
  }

  /** Small global SFX toggle, top-right on every screen (SPEC §9: mute). */
  private renderMute(): void {
    const { ctx } = this.vp;
    const r = this.muteRect();
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 13);
    ctx.fillStyle = 'rgba(23,31,58,0.75)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.border;
    ctx.stroke();
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.semibold} 10px ${fonts.family}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('SFX', r.x + 8, r.y + r.h / 2 + 0.5);
    ctx.beginPath();
    ctx.arc(r.x + r.w - 11, r.y + r.h / 2, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = this.audio.isMuted ? 'rgba(138,148,166,0.45)' : colors.rebateGold;
    ctx.fill();
    ctx.textBaseline = 'alphabetic';
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

  /** Matchmaking queue: level chip, searching spinner, cancel. */
  private renderLobby(): void {
    const { ctx, w, h } = this.vp;
    const cx = w / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.black} ${Math.min(w * 0.075, 30)}px ${fonts.family}`;
    ctx.fillText(COPY.challenge, cx, h * 0.24);

    // Level chip.
    ctx.fillStyle = this.level.color;
    ctx.font = `${fonts.weight.bold} 15px ${fonts.family}`;
    ctx.fillText(`${this.level.name.toUpperCase()} · ${this.level.weight}× pts`, cx, h * 0.29);

    // Spinner ring.
    const ry = h * 0.42;
    const r = 26;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(40,49,84,0.7)';
    ctx.beginPath();
    ctx.arc(cx, ry, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = colors.brandBlueFrom;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, ry, r, this.pulse * 3, this.pulse * 3 + Math.PI * 0.75);
    ctx.stroke();
    ctx.lineCap = 'butt';

    const dots = '.'.repeat(1 + (Math.floor(this.pulse * 2) % 3));
    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.semibold} 16px ${fonts.family}`;
    ctx.fillText(`${COPY.findingOpponent}${dots}`, cx, h * 0.52);

    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.medium} 12px ${fonts.family}`;
    wrapText(ctx, COPY.lobbyHint, Math.min(w * 0.8, 340)).forEach((ln, i) =>
      ctx.fillText(ln, cx, h * 0.575 + i * 17),
    );

    for (const b of this.lobbyButtons()) drawButton(ctx, b);
    ctx.textAlign = 'left';
  }

  /** The face-off: both Telegram profiles with a big VS between them. */
  private renderVs(): void {
    const { ctx, w, h } = this.vp;
    const cx = w / 2;
    const m = this.mpMatched;
    if (!m) return;

    // Facing glows behind each fighter.
    const glowL = ctx.createRadialGradient(w * 0.26, h * 0.42, 8, w * 0.26, h * 0.42, w * 0.3);
    glowL.addColorStop(0, 'rgba(10,120,255,0.22)');
    glowL.addColorStop(1, 'rgba(10,120,255,0)');
    ctx.fillStyle = glowL;
    ctx.fillRect(0, 0, w, h);
    const glowR = ctx.createRadialGradient(w * 0.74, h * 0.42, 8, w * 0.74, h * 0.42, w * 0.3);
    glowR.addColorStop(0, 'rgba(234,57,67,0.2)');
    glowR.addColorStop(1, 'rgba(234,57,67,0)');
    ctx.fillStyle = glowR;
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = this.level.color;
    ctx.font = `${fonts.weight.bold} 14px ${fonts.family}`;
    ctx.fillText(`${this.level.name.toUpperCase()} DUEL`, cx, h * 0.2);

    this.drawFighter(w * 0.26, h * 0.42, m.you.name, this.avatarYou, colors.brandBlueFrom);
    this.drawFighter(w * 0.74, h * 0.42, m.opp.name, this.avatarOpp, colors.down);

    // The VS mark — big, gold, with a pulse.
    const scale = 1 + 0.06 * Math.sin(this.pulse * 5);
    ctx.save();
    ctx.translate(cx, h * 0.43);
    ctx.scale(scale, scale);
    ctx.fillStyle = colors.rebateGold;
    ctx.shadowColor = 'rgba(245,196,81,0.6)';
    ctx.shadowBlur = 22;
    ctx.font = `${fonts.weight.black} ${Math.min(w * 0.13, 52)}px ${fonts.family}`;
    ctx.fillText(COPY.vsTitle, 0, 0);
    ctx.restore();

    const left = Math.max(1, Math.ceil(VS_SECONDS - this.vsT));
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.semibold} 14px ${fonts.family}`;
    ctx.fillText(COPY.startsIn(left), cx, h * 0.66);
    ctx.textAlign = 'left';
  }

  /** One side of the VS screen: avatar (photo or initial) in a colored ring + name. */
  private drawFighter(
    x: number,
    y: number,
    name: string,
    img: HTMLImageElement | null,
    ring: string,
  ): void {
    const { ctx } = this.vp;
    const r = Math.min(this.vp.w * 0.14, 54);

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = colors.surface;
    ctx.fill();
    ctx.clip();
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
    } else {
      // Initial-letter fallback (no photo / photo still loading).
      ctx.fillStyle = ring;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = colors.text;
      ctx.font = `${fonts.weight.black} ${r}px ${fonts.family}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((name[0] ?? '?').toUpperCase(), x, y + 2);
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = ring;
    ctx.stroke();

    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.bold} 15px ${fonts.family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(name, x, y + r + 26);
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

    if (this.live) {
      this.renderLiveResult(total, h, cx);
    } else if (this.mode === 'challenge') {
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

  /** Live 1-v-1 result: the server's verdict (or "waiting" until it lands). */
  private renderLiveResult(total: number, h: number, cx: number): void {
    const { ctx } = this.vp;
    const f = this.mpFinal;
    const oppName = this.mpMatched?.opp.name ?? 'Opponent';
    ctx.textAlign = 'center';
    if (!f) {
      const a = 0.55 + 0.35 * Math.sin(this.pulse * 3);
      ctx.save();
      ctx.globalAlpha = this.mpDropped ? 1 : a;
      ctx.fillStyle = this.mpDropped ? colors.down : colors.textMuted;
      ctx.font = `${fonts.weight.semibold} 14px ${fonts.family}`;
      ctx.fillText(this.mpDropped ? COPY.connectionLost : COPY.waitingOpponent, cx, h * 0.375);
      ctx.restore();
      return;
    }
    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.bold} 15px ${fonts.family}`;
    ctx.fillText(
      `${COPY.you} ${f.you.score}/${total}   ${COPY.vs}   ${oppName} ${f.opp.score}/${total}`,
      cx,
      h * 0.355,
    );
    const win = f.winner === 'you';
    const lose = f.winner === 'opp';
    ctx.fillStyle = win ? colors.up : lose ? colors.down : colors.textMuted;
    ctx.font = `${fonts.weight.black} 20px ${fonts.family}`;
    ctx.fillText(win ? COPY.youWin : lose ? COPY.youLose : COPY.tie, cx, h * 0.4);
    // How it was decided (sudden death / speed / forfeit).
    const note = f.forfeit
      ? COPY.oppLeftWin
      : f.onTime
        ? COPY.wonOnTime
        : f.sudden && f.sudden > 0
          ? COPY.suddenCount(f.sudden)
          : null;
    if (note) {
      ctx.fillStyle = colors.rebateGold;
      ctx.font = `${fonts.weight.medium} 12px ${fonts.family}`;
      ctx.fillText(note, cx, h * 0.428);
    }
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
      // Score decides; a tied score falls back to total decision time when the
      // challenge link carried it (faster wins — SPEC §4.3).
      let win = correct > opp;
      let lose = correct < opp;
      let onTime = false;
      const oppMs = this.opponent.timeMs;
      if (!win && !lose && oppMs && this.totalMs > 0 && Math.round(this.totalMs) !== oppMs) {
        win = this.totalMs < oppMs;
        lose = !win;
        onTime = true;
      }
      ctx.fillStyle = win ? colors.up : lose ? colors.down : colors.textMuted;
      ctx.font = `${fonts.weight.black} 20px ${fonts.family}`;
      ctx.fillText(win ? COPY.youWin : lose ? COPY.youLose : COPY.tie, cx, h * 0.41);
      if (onTime) {
        ctx.fillStyle = colors.rebateGold;
        ctx.font = `${fonts.weight.medium} 12px ${fonts.family}`;
        ctx.fillText(COPY.wonOnTime, cx, h * 0.438);
      }
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
