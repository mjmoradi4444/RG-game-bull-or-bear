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
import {
  fetchBoard,
  fetchProfile,
  matchAbort,
  matchResult,
  matchStart,
  type OppKind,
  type RankedMode,
  type RoundOut,
  type RpOutcome,
  type SeasonBoard,
  type SeasonProfile,
} from '../net/SeasonApi';
import {
  fetchAccount,
  saveEmail,
  deleteEmail,
  isValidEmailClient,
  suggestEmailClient,
  type AccountView,
} from '../net/AccountApi';
import { Title } from '../ui/Title';
import { EmailOverlay } from '../ui/EmailOverlay';
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

/** Compact countdown: "3d 4h" · "4h 12m" · "12m" (client renders local-agnostic). */
function fmtDuration(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** "2026-07" → "July" (season display name — PRD §5.C). */
function seasonName(id: string): string {
  const m = Number(id.slice(5, 7));
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return names[m - 1] ?? id;
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
  private leaderboardError = false;
  /** Where the leaderboard was opened from, so Back returns there (result vs title). */
  private leaderboardFrom: Screen = 'title';

  // Seasonal scoring + Rush Tokens (PRD-SCORING-TOKENS Phase A).
  /** Live season profile — null in plain-browser dev (no gctx) → free play only. */
  private profile: SeasonProfile | null = null;
  /** Single-use ranked matchToken from POST /match/start; null once spent. */
  private matchToken: string | null = null;
  /** Per-round log submitted to /match/result (server recomputes RP from it). */
  private roundsLog: RoundOut[] = [];
  /** RP submission state rendered on the result screen. */
  private rpResult: RpOutcome | 'pending' | 'failed' | null = null;
  /** Guards double-taps while POST /match/start is in flight. */
  private startPending = false;
  /** Transient notice (out of tokens / start failed) on title + level select. */
  private notice: { text: string; until: number } | null = null;
  /** Seasonal leaderboard payload (podium + rows); null → legacy board fallback. */
  private boardData: SeasonBoard | null = null;
  private readonly avatarCache = new Map<number, HTMLImageElement>();

  // Email capture (PRD-ADMIN-EMAIL §5). account is null in plain-browser dev.
  private account: AccountView | null = null;
  private readonly emailOverlay = new EmailOverlay();
  /** Screen to return to when leaving the email screen. */
  private emailReturn: Screen = 'title';
  private emailMsg: { text: string; kind: 'ok' | 'err' } | null = null;
  private emailSuggestion: string | null = null;
  private emailSaving = false;
  /** Whether the one-time result-screen email nudge has been shown/dismissed. */
  private emailPromptDismissed = false;

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
  /** Lobby resilience: auto-retry a dropped queue socket before giving up. */
  private mpRetries = 0;
  private mpRetryAt = 0;
  /** When set, level select shows the "multiplayer unreachable" notice until this pulse. */
  private mpErrorUntil = 0;
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
    // The email screen owns an HTML <input> overlay; keep it shown+aligned only
    // while that screen is up, and torn down the moment we navigate away.
    if (this.screen === 'email') this.emailOverlay.reposition(this.emailInputRect());
    else if (this.emailOverlay.visible()) this.emailOverlay.hide();
    if (this.input.consumeFire()) this.onTap();
    const gesture = this.input.takeGesture(); // drained every tick to avoid buildup
    this.particles.update(dt);

    // VS intro: hold the face-off for a beat, then start the live match.
    if (this.screen === 'vs' && this.mpMatched) {
      this.vsT += dt;
      if (this.vsT >= VS_SECONDS) this.startLiveMatch();
    }

    // Lobby resilience: a dropped queue socket retries on a short backoff (proxy
    // hiccups, flaky mobile radio) before giving up back to level select.
    if (this.screen === 'lobby' && this.mpRetryAt > 0 && this.pulse >= this.mpRetryAt) {
      this.mpRetryAt = 0;
      this.mp?.dispose();
      this.mp = this.makeMp();
      this.mp.queue(this.level.id, { gctx: launchGctx(), name: this.adapter.getUser()?.name });
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
    // Ranked round log — /match/result recomputes RP from exactly this (PRD §8.3).
    this.roundsLog.push({ n: r.index + 1, call: r.call, correct: r.correct, ms });
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
    // Season profile (tokens / streak / rank) — null in plain-browser dev.
    void fetchProfile().then((p) => {
      this.profile = p;
    });
    // Linked-account state for the email flow (null without a bot launch context).
    void fetchAccount().then((a) => {
      this.account = a;
    });
  }

  private refreshProfile(): void {
    if (!this.profile) return;
    void fetchProfile().then((p) => {
      if (p) this.profile = p;
    });
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
    this.roundsLog = [];
    this.rpResult = null;
    this.roundView.reset();
    this.combo = 0;
    this.bestCombo = 0;
    this.shake = 0;
    this.verdictFired = false;
    this.lastRoundIndex = -1;
    this.screen = 'round';
  }

  // ---- seasonal ranked flow (PRD-SCORING-TOKENS Phase A) -------------------

  private showNotice(text: string, seconds = 6): void {
    this.notice = { text, until: this.pulse + seconds };
  }

  /** Spend a Rush Token via POST /match/start, then launch the chosen flavor. */
  private startRanked(flavor: RankedMode, level: Level): void {
    if (this.startPending) return;
    this.startPending = true;
    matchStart(flavor, level.id)
      .then((res) => {
        this.startPending = false;
        if (res.ok) {
          this.matchToken = res.matchToken;
          if (this.profile) this.profile.tokens = res.tokens;
          if (flavor === 'live') this.enterLobby(level);
          else this.startMatch(flavor === 'quick' ? 'practice' : 'challenge', level);
        } else {
          if (this.profile) this.profile.tokens = 0;
          this.screen = 'title';
          this.showNotice(COPY.outOfTokens(fmtDuration(res.refillAt - Date.now())));
        }
      })
      .catch(() => {
        this.startPending = false;
        this.showNotice(COPY.startFailed);
      });
  }

  /** Submit the ranked result; the server recomputes RP from the round log. */
  private submitRp(won: boolean, oppKind: OppKind): void {
    const mt = this.matchToken;
    if (!mt) return;
    this.matchToken = null; // single-use — never submit twice
    this.rpResult = 'pending';
    matchResult(mt, this.roundsLog, won, oppKind)
      .then((r) => {
        this.rpResult = r;
        if (this.profile) {
          this.profile.rp = r.seasonRp;
          this.profile.rank = r.rank;
          this.profile.tokens = r.tokens;
        }
      })
      .catch(() => {
        this.rpResult = 'failed';
      });
  }

  /** Refund the token if the match died before round 1 resolved (PRD §5.A). */
  private refundIfUnplayed(): void {
    const mt = this.matchToken;
    if (!mt || this.roundsLog.length > 0) return;
    this.matchToken = null;
    void matchAbort(mt).then((tokens) => {
      if (tokens !== null && this.profile) this.profile.tokens = tokens;
    });
  }

  /** Bank base RP for a live match the player is abandoning (no final verdict yet):
   *  played rounds still count; the win bonus only if a final already declared it. */
  private flushPendingRp(): void {
    if (!this.matchToken) return;
    if (this.roundsLog.length === 0) {
      this.refundIfUnplayed();
      return;
    }
    const won = this.mpFinal?.winner === 'you';
    this.submitRp(won, this.mpMatched?.oppAi ? 'ai' : 'human');
  }

  /** Async duel outcome vs the challenge link (same rule the result screen shows). */
  private asyncWon(): boolean {
    if (!this.match || !this.opponent) return false;
    const mine = this.match.correctCount;
    const opp = this.opponent.score;
    if (mine !== opp) return mine > opp;
    const oppMs = this.opponent.timeMs;
    if (oppMs && this.totalMs > 0 && Math.round(this.totalMs) !== oppMs) return this.totalMs < oppMs;
    return false;
  }

  // ---- live 1-v-1 matchmaking ---------------------------------------------
  private makeMp(): Multiplayer {
    return new Multiplayer({
      onMatched: (m) => this.onMpMatched(m),
      onSudden: () => this.onMpSudden(),
      onFinal: (f) => this.onMpFinal(f),
      onDrop: () => this.onMpDrop(),
    });
  }

  private enterLobby(level: Level): void {
    this.level = level;
    this.mpMatched = null;
    this.mpFinal = null;
    this.mpDropped = false;
    this.mpRetries = 0;
    this.mpRetryAt = 0;
    this.avatarYou = null;
    this.avatarOpp = null;
    this.screen = 'lobby';
    this.mp?.dispose();
    this.mp = this.makeMp();
    this.mp.queue(level.id, { gctx: launchGctx(), name: this.adapter.getUser()?.name });
  }

  private onMpMatched(m: MpMatched): void {
    this.mpRetries = 0;
    this.mpRetryAt = 0;
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
    // Ranked live duel: the verdict is in — submit the RP result now (win bonus
    // halves vs an AI fill — PRD §5.B).
    if (this.matchToken)
      this.submitRp(f.winner === 'you', this.mpMatched?.oppAi ? 'ai' : 'human');
    // Forfeit can land mid-round — jump to the result; a normal final lands while
    // we're already on (or headed to) the result screen.
    if (f.forfeit) this.screen = 'result';
  }

  private onMpDrop(): void {
    this.mpDropped = true;
    if (this.screen === 'lobby') {
      // Retry the queue a few times (proxy hiccup / flaky mobile radio) before
      // giving up — never bounce the player out on the first drop.
      if (this.mpRetries < 3) {
        this.mpRetries++;
        this.mpRetryAt = this.pulse + 1.5;
        return;
      }
      this.refundIfUnplayed(); // ranked queue died before round 1 → token back
      this.screen = 'levelSelect';
      this.mpErrorUntil = this.pulse + 6; // level select explains what happened
      return;
    }
    if (this.screen === 'vs') {
      this.refundIfUnplayed();
      this.screen = 'levelSelect';
    }
    // Mid-match: the render shows "connection lost" on the result if no final came.
  }

  private leaveLobby(): void {
    this.mpRetryAt = 0;
    this.mp?.leave();
    this.mp = null;
    this.refundIfUnplayed(); // deliberate exit before a match → token back (PRD §5.A)
    this.screen = 'levelSelect';
  }

  private finishMatch(): void {
    if (this.matchToken) {
      // Ranked (seasonal RP — PRD §5.B). Quick Play is solo; an incoming async
      // duel resolves vs the challenger's real linked result; an outgoing async
      // challenge has no verified opponent yet → base RP only, no win bonus.
      // Live duels submit when the server's final verdict lands (onMpFinal).
      if (this.mode === 'practice') this.submitRp(false, 'none');
      else if (this.mode === 'challenge' && !this.live)
        this.submitRp(this.opponent ? this.asyncWon() : false, this.opponent ? 'human' : 'none');
    } else if (this.match && this.mode === 'practice') {
      // Legacy path (plain-browser dev / stale clients): best-score board.
      void this.adapter.submitScore(this.match.correctCount * this.level.weight);
    }
    this.screen = 'result';
  }

  private enterLeaderboard(): void {
    this.leaderboardFrom = this.screen;
    this.screen = 'leaderboard';
    if (this.profile) this.loadBoard(true);
    else this.loadLeaderboard(true);
  }

  /** Seasonal board (podium + season rows — PRD §5.C); one silent retry. */
  private loadBoard(retryOnce: boolean): void {
    this.leaderboardLoading = true;
    this.leaderboardError = false;
    fetchBoard()
      .then((b) => {
        this.boardData = b;
        this.leaderboardLoading = false;
        // Pre-warm avatars for the podium + visible rows (never-broken fallback).
        for (const e of b.hallOfFame) this.avatarFor(e.u);
        for (const r of b.rows.slice(0, 12)) this.avatarFor(r.u);
      })
      .catch(() => {
        if (retryOnce) {
          setTimeout(() => {
            if (this.screen === 'leaderboard') this.loadBoard(false);
          }, 1200);
          return;
        }
        this.leaderboardLoading = false;
        this.leaderboardError = true;
      });
  }

  private avatarFor(u: number): HTMLImageElement {
    let img = this.avatarCache.get(u);
    if (!img) {
      img = new Image();
      img.src = `${apiBase()}/avatar/${u}`;
      this.avatarCache.set(u, img);
    }
    return img;
  }

  /** Legacy best-score board (plain-browser dev); one silent retry on failure. */
  private loadLeaderboard(retryOnce: boolean): void {
    this.leaderboardLoading = true;
    this.leaderboardError = false;
    this.leaderboard = [];
    this.adapter
      .getLeaderboard()
      .then((rows) => {
        this.leaderboard = rows;
        this.leaderboardLoading = false;
      })
      .catch(() => {
        if (retryOnce) {
          setTimeout(() => {
            if (this.screen === 'leaderboard') this.loadLeaderboard(false);
          }, 1200);
          return;
        }
        this.leaderboardLoading = false;
        this.leaderboardError = true;
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
        } else if (this.boardData && this.hitRect(this.prizesChipRect(), px, py)) {
          this.audio.coin();
          this.screen = 'prizes';
        }
        break;
      case 'prizes':
        if (hitButton(this.backButtons(), px, py) === 'back') {
          this.audio.coin();
          this.screen = this.boardData ? 'leaderboard' : 'title';
        } else if (this.account && this.hitRect(this.prizeLinkCtaRect(), px, py)) {
          this.audio.coin();
          this.enterEmail('prizes');
        }
        break;
      case 'email':
        this.onTapEmail(px, py);
        break;
    }
  }

  private onTapEmail(px: number, py: number): void {
    if (hitButton(this.backButtons(), px, py) === 'back') {
      this.audio.coin();
      this.leaveEmail();
      return;
    }
    // Tap the "Did you mean …?" suggestion to accept it.
    if (this.emailSuggestion && this.hitRect(this.emailSuggestionRect(), px, py)) {
      this.emailOverlay.setValue(this.emailSuggestion);
      this.emailSuggestion = null;
      this.emailMsg = null;
      this.audio.coin();
      return;
    }
    if (this.hitRect(this.emailCreateRect(), px, py)) {
      this.audio.coin();
      this.adapter.openLink(SIGNUP_URL);
      return;
    }
    const id = hitButton(this.emailButtons(), px, py);
    if (id === 'save') this.onSaveEmail();
    else if (id === 'remove') this.onRemoveEmail();
  }

  private emailSuggestionRect(): { x: number; y: number; w: number; h: number } {
    const { w, h } = this.vp;
    return { x: w * 0.1, y: h * 0.44 + 56, w: w * 0.8, h: 22 };
  }

  private emailCreateRect(): { x: number; y: number; w: number; h: number } {
    const { w, h } = this.vp;
    return { x: w * 0.1, y: h * 0.72, w: w * 0.8, h: 22 };
  }

  private prizeLinkCtaRect(): { x: number; y: number; w: number; h: number } {
    const { w, h } = this.vp;
    const cw = Math.min(w * 0.84, 360);
    return { x: w / 2 - cw / 2, y: h * 0.8, w: cw, h: 46 };
  }

  private hitRect(r: { x: number; y: number; w: number; h: number }, px: number, py: number): boolean {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  // ---- email capture (PRD-ADMIN-EMAIL §5) ---------------------------------

  private enterEmail(from: Screen): void {
    this.emailReturn = from;
    this.emailMsg = null;
    this.emailSuggestion = null;
    this.screen = 'email';
    this.emailOverlay.show(this.emailInputRect(), '', () => this.onSaveEmail());
  }

  private leaveEmail(): void {
    this.emailOverlay.hide();
    this.screen = this.emailReturn;
  }

  private onSaveEmail(): void {
    if (this.emailSaving) return;
    const email = this.emailOverlay.value().trim();
    this.emailSuggestion = suggestEmailClient(email);
    if (!isValidEmailClient(email)) {
      this.emailMsg = { text: COPY.emailInvalid, kind: 'err' };
      this.audio.loss();
      return;
    }
    this.emailSaving = true;
    this.emailMsg = null;
    void saveEmail(email).then((r) => {
      this.emailSaving = false;
      if (r.ok) {
        this.audio.win();
        this.adapter.haptic('success');
        this.emailSuggestion = null;
        this.emailMsg = { text: COPY.emailSaved, kind: 'ok' };
        if (this.account) {
          this.account.masked = r.masked;
          this.account.changesLeft = r.changesLeft;
        } else {
          this.account = { masked: r.masked, changesLeft: r.changesLeft, emailSetAt: Date.now(), eligible: false, frozen: false };
        }
        this.emailOverlay.setValue('');
      } else {
        this.audio.loss();
        const map: Record<string, string> = {
          invalid_email: COPY.emailInvalid,
          change_limit: COPY.emailChangeLimit,
          frozen: COPY.emailFrozen,
          rate_limited: COPY.emailRateLimited,
          network: COPY.emailNetwork,
        };
        this.emailMsg = { text: map[r.error] ?? COPY.emailNetwork, kind: 'err' };
      }
    });
  }

  private onRemoveEmail(): void {
    void deleteEmail().then((ok) => {
      if (ok && this.account) {
        this.account.masked = null;
        this.emailMsg = { text: COPY.emailRemove, kind: 'ok' };
        this.audio.coin();
      } else {
        this.emailMsg = { text: COPY.emailFrozen, kind: 'err' };
      }
    });
  }

  private emailInputRect(): { x: number; y: number; w: number; h: number } {
    const { w, h } = this.vp;
    const iw = Math.min(w * 0.84, 360);
    return { x: w / 2 - iw / 2, y: h * 0.44, w: iw, h: 50 };
  }

  private emailButtons(): Button[] {
    const { w, h } = this.vp;
    const bw = Math.min(w * 0.84, 360);
    const bx = w / 2 - bw / 2;
    const bh = 50;
    const out: Button[] = [];
    out.push({ id: 'save', x: bx, y: h * 0.58, w: bw, h: bh, label: this.account?.masked ? COPY.emailUpdate : COPY.emailSave, kind: 'gold' });
    if (this.account?.masked) {
      out.push({ id: 'remove', x: bx, y: h * 0.58 + bh + 10, w: bw, h: 44, label: COPY.emailRemove, kind: 'ghost' });
    }
    return out;
  }

  private accountChipRect(): { x: number; y: number; w: number; h: number } {
    const { w, h } = this.vp;
    const cw = Math.min(w * 0.6, 220);
    return { x: w / 2 - cw / 2, y: h * 0.8, w: cw, h: 30 };
  }

  /** Season chips row (top-left, mirrors the mute chip): tokens · streak · countdown. */
  private chipRects(): Array<{ id: 'tokens' | 'streak' | 'season'; x: number; y: number; w: number; h: number }> {
    if (!this.profile) return [];
    const out: Array<{ id: 'tokens' | 'streak' | 'season'; x: number; y: number; w: number; h: number }> = [];
    let x = 12;
    const add = (id: 'tokens' | 'streak' | 'season', w: number): void => {
      out.push({ id, x, y: 12, w, h: 26 });
      x += w + 8;
    };
    add('tokens', 62);
    if (this.profile.multiplier > 1) add('streak', 64);
    add('season', 70);
    return out;
  }

  private prizesChipRect(): { x: number; y: number; w: number; h: number } {
    return { x: 12, y: 12, w: 78, h: 26 };
  }

  /** Shared chip taps on title / level select: tokens → refill info, season → prizes. */
  private onChipTap(px: number, py: number): boolean {
    for (const c of this.chipRects()) {
      if (!this.hitRect(c, px, py)) continue;
      this.audio.coin();
      if (c.id === 'season') this.screen = 'prizes';
      else if (c.id === 'tokens' && this.profile) {
        this.showNotice(
          this.profile.tokens <= 0
            ? COPY.outOfTokens(fmtDuration(this.profile.refillAt - Date.now()))
            : COPY.tokenCost,
        );
      } else if (this.profile) {
        this.showNotice(COPY.rpMultiplier(this.profile.multiplier));
      }
      return true;
    }
    return false;
  }

  private onTapTitle(px: number, py: number): void {
    if (this.onChipTap(px, py)) return;
    // Account-link chip (only when launched from the bot — email is for prizes).
    if (this.account && this.hitRect(this.accountChipRect(), px, py)) {
      this.audio.coin();
      this.enterEmail('title');
      return;
    }
    // The small brand-CTA chip (the campaign funnel, kept light).
    const cr = this.title.ctaRect(this.vp);
    if (px >= cr.x && px <= cr.x + cr.w && py >= cr.y && py <= cr.y + cr.h) {
      this.audio.coin();
      this.adapter.openLink(SIGNUP_URL);
      return;
    }
    const id = hitButton(this.title.buttons(this.vp, !!this.profile), px, py);
    if (!id) return;
    this.audio.coin();
    if (id === 'leaderboard') {
      this.enterLeaderboard();
    } else if (id === 'free') {
      this.pendingMode = 'free';
      this.screen = 'levelSelect';
    } else if (id === 'challenge' || id === 'practice') {
      // Ranked modes need a Rush Token; with 0 left, explain and point at
      // free Practice instead of a dead tap (PRD Story 1).
      if (this.profile && this.profile.tokens <= 0) {
        this.showNotice(COPY.outOfTokens(fmtDuration(this.profile.refillAt - Date.now())));
        return;
      }
      // An incoming challenge fixes the level (must match the challenger); otherwise
      // let the player pick a level first.
      if (id === 'challenge' && this.opponent) {
        if (this.profile) this.startRanked('duel', this.level);
        else this.startMatch('challenge', this.level);
      } else {
        this.pendingMode = id;
        this.screen = 'levelSelect';
      }
    }
  }

  private onTapLevelSelect(px: number, py: number): void {
    if (this.onChipTap(px, py)) return;
    if (hitButton(this.backButtons(), px, py) === 'back') {
      this.audio.coin();
      this.screen = 'title';
      return;
    }
    for (const lv of LEVELS) {
      const r = this.levelCardRect(lv);
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
        this.audio.coin();
        this.beginFromLevel(lv);
        return;
      }
    }
  }

  /** Launch the pending mode on the chosen level: free = no token; ranked = spend
   *  a Rush Token via /match/start first (PRD §5.A). Multiplayer queues a live duel. */
  private beginFromLevel(lv: Level): void {
    if (this.pendingMode === 'free') {
      this.startMatch('free', lv);
      return;
    }
    if (this.profile) {
      if (this.profile.tokens <= 0) {
        this.screen = 'title';
        this.showNotice(COPY.outOfTokens(fmtDuration(this.profile.refillAt - Date.now())));
        return;
      }
      this.startRanked(this.pendingMode === 'challenge' ? 'live' : 'quick', lv);
      return;
    }
    // Plain-browser dev (no season backend): the legacy free flow.
    if (this.pendingMode === 'challenge') this.enterLobby(lv);
    else this.startMatch(this.pendingMode, lv);
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

  /** One-time nudge: a ranked top-20 finisher with no linked email (PRD §5.1),
   *  rate-limited to once per 24h via localStorage. */
  private shouldPromptEmail(): boolean {
    if (!this.account || this.account.masked || this.emailPromptDismissed) return false;
    const r = this.rpResult;
    if (!r || typeof r === 'string' || r.rank === 0 || r.rank > 20) return false;
    try {
      const last = Number(localStorage.getItem('bob_email_prompt') ?? '0');
      if (Date.now() - last < 24 * 60 * 60 * 1000) return false;
    } catch {
      /* localStorage unavailable → still show it */
    }
    return true;
  }

  private resultEmailPromptRect(): { x: number; y: number; w: number; h: number } {
    const { w, h } = this.vp;
    const cw = Math.min(w * 0.9, 380);
    return { x: w / 2 - cw / 2, y: h * 0.085, w: cw, h: 42 };
  }

  /** The one-time "add your email" banner on the result screen (tappable). */
  private renderResultEmailPrompt(): void {
    const { ctx } = this.vp;
    const r = this.resultEmailPromptRect();
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 10);
    ctx.fillStyle = 'rgba(245,196,81,0.1)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(245,196,81,0.5)';
    ctx.stroke();
    ctx.fillStyle = colors.rebateGold;
    ctx.font = `${fonts.weight.semibold} 12px ${fonts.family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    wrapText(ctx, COPY.emailPrompt, r.w - 20).forEach((ln, i, a) =>
      ctx.fillText(ln, r.x + r.w / 2, r.y + r.h / 2 + (i - (a.length - 1) / 2) * 14),
    );
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
  }

  private onTapResult(px: number, py: number): void {
    if (this.shouldPromptEmail() && this.hitRect(this.resultEmailPromptRect(), px, py)) {
      this.audio.coin();
      this.emailPromptDismissed = true;
      try {
        localStorage.setItem('bob_email_prompt', String(Date.now()));
      } catch {
        /* ignore */
      }
      this.enterEmail('result');
      return;
    }
    const id = hitButton(this.resultButtons(), px, py);
    if (!id) return;
    this.audio.coin();
    if (id === 'cta') {
      this.adapter.openLink(SIGNUP_URL);
    } else if (id === 'rematch') {
      if (this.mode === 'challenge') this.opponent = null; // a fresh challenge to send
      // Free practice replays for free; ranked replays spend another Rush Token.
      if (this.mode === 'free' || !this.profile) {
        if (this.live) this.enterLobby(this.level);
        else this.startMatch(this.mode, this.level);
        return;
      }
      if (this.profile.tokens <= 0) {
        this.screen = 'title';
        this.showNotice(COPY.outOfTokens(fmtDuration(this.profile.refillAt - Date.now())));
        return;
      }
      this.startRanked(this.live ? 'live' : this.mode === 'challenge' ? 'duel' : 'quick', this.level);
    } else if (id === 'leaderboard') {
      this.enterLeaderboard();
    } else if (id === 'share') {
      this.shareResult();
    } else if (id === 'menu') {
      // Safety net: if a live ranked match never got a server final (client
      // dropped), still bank the base RP for the rounds actually played.
      this.flushPendingRp();
      this.mp?.dispose();
      this.mp = null;
      this.live = false;
      this.refreshProfile();
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
      const locked =
        this.profile && this.profile.tokens <= 0 ? new Set(['challenge', 'practice']) : undefined;
      this.title.render(ctx, this.vp, this.pulse, banner, { includeFree: !!this.profile, locked });
      if (this.account) this.renderAccountChip();
    }
    else if (this.screen === 'levelSelect') this.renderLevelSelect();
    else if (this.screen === 'prizes') this.renderPrizes();
    else if (this.screen === 'email') this.renderEmail();
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

    // Season HUD chips (tokens/streak/countdown) + transient notice sit above the
    // title & level-select screens, alongside the mute chip.
    if (this.screen === 'title' || this.screen === 'levelSelect') {
      this.renderChips();
      this.renderNotice();
    }

    this.particles.render(ctx);
    this.renderMute();
  }

  /** Top-left season chips: ⚡tokens · 🔥streak · ⏳countdown (PRD §7 title HUD). */
  private renderChips(): void {
    if (!this.profile) return;
    const { ctx } = this.vp;
    ctx.textBaseline = 'middle';
    for (const c of this.chipRects()) {
      roundRectPath(ctx, c.x, c.y, c.w, c.h, 13);
      const low = c.id === 'tokens' && this.profile.tokens <= 0;
      ctx.fillStyle = low ? 'rgba(234,57,67,0.18)' : 'rgba(23,31,58,0.75)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = low ? colors.down : colors.border;
      ctx.stroke();
      ctx.fillStyle = c.id === 'tokens' ? (low ? colors.down : colors.rebateGold) : colors.text;
      ctx.font = `${fonts.weight.bold} 11px ${fonts.family}`;
      ctx.textAlign = 'center';
      const label =
        c.id === 'tokens'
          ? COPY.tokens(this.profile.tokens, 10)
          : c.id === 'streak'
            ? COPY.streakChip(this.profile.multiplier)
            : COPY.seasonEndsShort(fmtDuration(this.profile.season.endsAt - Date.now()));
      ctx.fillText(label, c.x + c.w / 2, c.y + c.h / 2 + 0.5);
    }
    ctx.textBaseline = 'alphabetic';
  }

  /** Transient one-line notice (out of tokens / start failed / streak info). */
  private renderNotice(): void {
    if (!this.notice || this.pulse >= this.notice.until) return;
    const { ctx, w } = this.vp;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.rebateGold;
    ctx.font = `${fonts.weight.semibold} 12px ${fonts.family}`;
    wrapText(ctx, this.notice.text, Math.min(w * 0.82, 340)).forEach((ln, i) =>
      ctx.fillText(ln, w / 2, 52 + i * 15),
    );
    ctx.textAlign = 'left';
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
    ctx.fillText(
      this.pendingMode === 'free' ? COPY.chooseLevelFreeHint : COPY.chooseLevelHint,
      cx,
      h * 0.2 + 24,
    );

    // Transient notice after multiplayer gave up reconnecting.
    if (this.pulse < this.mpErrorUntil) {
      ctx.fillStyle = colors.down;
      ctx.font = `${fonts.weight.semibold} 12px ${fonts.family}`;
      wrapText(ctx, COPY.mpUnreachable, Math.min(w * 0.84, 350)).forEach((ln, i) =>
        ctx.fillText(ln, cx, h * 0.2 + 46 + i * 16),
      );
    }

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
      // RP-per-correct badge top-right (or "Free · no RP" in free practice).
      ctx.textAlign = 'right';
      ctx.fillStyle = this.pendingMode === 'free' ? colors.textMuted : colors.rebateGold;
      ctx.font = `${fonts.weight.bold} 13px ${fonts.family}`;
      ctx.fillText(
        this.pendingMode === 'free' ? COPY.freeNoRp : COPY.ptsPerCorrect(lv.weight),
        r.x + r.w - 18,
        r.y + 30,
      );
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
    const searching = this.mpRetries > 0 ? `${COPY.reconnecting} (${this.mpRetries}/3)` : COPY.findingOpponent;
    ctx.fillStyle = this.mpRetries > 0 ? colors.rebateGold : colors.text;
    ctx.font = `${fonts.weight.semibold} 16px ${fonts.family}`;
    ctx.fillText(`${searching}${dots}`, cx, h * 0.52);

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

    // Ranked RP earned + season total + rank delta (PRD Story 2). Only for ranked
    // matches (rpResult set); free practice and legacy dev skip it.
    if (this.rpResult) this.renderRp(cx, h);

    ctx.fillStyle = 'rgba(245,196,81,0.9)';
    ctx.font = `${fonts.weight.medium} 13px ${fonts.family}`;
    ctx.textAlign = 'center';
    wrapText(ctx, COPY.rebateReminder, Math.min(w * 0.82, 340)).forEach((ln, i) =>
      ctx.fillText(ln, cx, h * 0.475 + i * 16),
    );

    for (const b of this.resultButtons()) drawButton(ctx, b);

    if (this.shouldPromptEmail()) this.renderResultEmailPrompt();

    ctx.fillStyle = 'rgba(138,148,166,0.7)';
    ctx.font = `${fonts.weight.medium} 10px ${fonts.family}`;
    wrapText(ctx, COPY.pointsDisclaimer, Math.min(w * 0.86, 360)).forEach((ln, i) =>
      ctx.fillText(ln, cx, h * 0.955 + i * 13),
    );
    ctx.textAlign = 'left';
  }

  /** Ranked RP strip on the result screen (PRD Story 2): +RP · season total · rank Δ. */
  private renderRp(cx: number, h: number): void {
    const { ctx } = this.vp;
    ctx.textAlign = 'center';
    const r = this.rpResult;
    if (!r) return;
    if (r === 'pending') {
      ctx.fillStyle = colors.textMuted;
      ctx.font = `${fonts.weight.semibold} 13px ${fonts.family}`;
      ctx.fillText(COPY.rpPending, cx, h * 0.405);
      return;
    }
    if (r === 'failed') {
      ctx.fillStyle = colors.down;
      ctx.font = `${fonts.weight.semibold} 12px ${fonts.family}`;
      ctx.fillText(COPY.rpFailed, cx, h * 0.405);
      return;
    }
    if (typeof r === 'string') return;
    // Big +RP with the delta chip beside it.
    ctx.fillStyle = colors.up;
    ctx.font = `${fonts.weight.black} 22px ${fonts.family}`;
    ctx.fillText(COPY.rpEarned(r.rp), cx, h * 0.405);
    // Season total + rank (with a → delta when the rank moved up).
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.medium} 12px ${fonts.family}`;
    const delta = r.rankDelta > 0 ? `  ·  ${COPY.rankDelta(r.rank + r.rankDelta, r.rank)}` : '';
    ctx.fillText(`${COPY.seasonTotal(r.seasonRp, r.rank)}${delta}`, cx, h * 0.405 + 20);
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
    if (this.boardData || this.profile) {
      this.renderSeasonBoard();
      return;
    }
    this.renderLegacyBoard();
  }

  // Medal palette for the top 3 (gold/silver/bronze — PRD §5.C).
  private static readonly MEDALS = ['#F5C451', '#C7CEDA', '#CD8B5A'];
  private static readonly MEDAL_ICONS = ['🥇', '🥈', '🥉'];

  /** Seasonal board: Hall of Fame podium → season name + countdown → RP rows. */
  private renderSeasonBoard(): void {
    const { ctx, w, h } = this.vp;
    const cx = w / 2;
    const b = this.boardData;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.black} ${Math.min(w * 0.07, 26)}px ${fonts.family}`;
    ctx.fillText(COPY.leaderboard, cx, h * 0.09);

    // Prizes entry (tappable chip, top-left) — the funnel is always one tap away.
    const pr = this.prizesChipRect();
    roundRectPath(ctx, pr.x, pr.y, pr.w, pr.h, 13);
    ctx.fillStyle = 'rgba(245,196,81,0.1)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(245,196,81,0.5)';
    ctx.stroke();
    ctx.fillStyle = colors.rebateGold;
    ctx.font = `${fonts.weight.bold} 11px ${fonts.family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`🏆 ${COPY.prizes}`, pr.x + pr.w / 2, pr.y + pr.h / 2 + 0.5);
    ctx.textBaseline = 'alphabetic';

    let y = h * 0.14;

    // Hall of Fame podium (previous season's top 3), when there is one.
    if (b && b.hallOfFame.length > 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = colors.textMuted;
      ctx.font = `${fonts.weight.semibold} 11px ${fonts.family}`;
      ctx.fillText(COPY.hallOfFame.toUpperCase(), cx, y);
      y += 12;
      const slots = b.hallOfFame.slice(0, 3);
      const spread = Math.min(w * 0.26, 108);
      // Order 2·1·3 so #1 sits centered and largest.
      const order = slots.length === 3 ? [slots[1]!, slots[0]!, slots[2]!] : slots;
      order.forEach((e, i) => {
        const px = cx + (i - (order.length - 1) / 2) * spread;
        const isFirst = e.rank === 1;
        const rr = isFirst ? 30 : 24;
        const py = y + (isFirst ? 30 : 38);
        this.drawAvatarCircle(px, py, rr, e.u, e.name, Game.MEDALS[e.rank - 1]!);
        ctx.textAlign = 'center';
        ctx.font = `${fonts.weight.black} 16px ${fonts.family}`;
        ctx.fillText(Game.MEDAL_ICONS[e.rank - 1]!, px, py - rr - 4);
        ctx.fillStyle = colors.text;
        ctx.font = `${fonts.weight.bold} 12px ${fonts.family}`;
        ctx.fillText(this.ellipsize(e.name, 10), px, py + rr + 15);
        ctx.fillStyle = Game.MEDALS[e.rank - 1]!;
        ctx.font = `${fonts.weight.bold} 11px ${fonts.family}`;
        ctx.fillText(`${e.rp.toLocaleString('en-US')} RP`, px, py + rr + 29);
      });
      y += 96;
    }

    // Season name + countdown.
    if (b) {
      ctx.textAlign = 'center';
      ctx.fillStyle = colors.rebateGold;
      ctx.font = `${fonts.weight.bold} 13px ${fonts.family}`;
      ctx.fillText(COPY.seasonLabel(seasonName(b.season.id)), cx, y);
      ctx.fillStyle = colors.textMuted;
      ctx.font = `${fonts.weight.medium} 11px ${fonts.family}`;
      ctx.fillText(COPY.seasonEndsIn(fmtDuration(b.season.endsAt - Date.now())), cx, y + 15);
      y += 30;
    }

    const listX = w * 0.1;
    const listW = w * 0.8;
    const rowH = 38;
    const bottomLimit = h * 0.8;

    if (this.leaderboardError) {
      ctx.textAlign = 'center';
      ctx.fillStyle = colors.down;
      ctx.font = `${fonts.weight.semibold} 13px ${fonts.family}`;
      wrapText(ctx, COPY.lbError, Math.min(w * 0.82, 340)).forEach((ln, i) =>
        ctx.fillText(ln, cx, y + 24 + i * 18),
      );
    } else if (this.leaderboardLoading || !b) {
      ctx.textAlign = 'center';
      ctx.fillStyle = colors.textMuted;
      ctx.font = `${fonts.weight.medium} 14px ${fonts.family}`;
      ctx.fillText('Loading…', cx, y + 24);
    } else if (b.rows.length === 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = colors.textMuted;
      ctx.font = `${fonts.weight.medium} 14px ${fonts.family}`;
      ctx.fillText('Be the first to score this season.', cx, y + 24);
    } else {
      const maxRows = Math.max(3, Math.floor((bottomLimit - y) / rowH));
      const selfVisible = b.rows.slice(0, maxRows).some((r) => r.isSelf);
      const visible = b.rows.slice(0, selfVisible || !b.self ? maxRows : maxRows - 1);
      for (const row of visible) {
        this.drawBoardRow(row, listX, y, listW, rowH);
        y += rowH;
      }
      // Pin the self row below the list when outside the visible window (PRD Story 4).
      if (!selfVisible && b.self) {
        y += 4;
        this.drawBoardRow(
          { rank: b.self.rank, u: 0, name: COPY.yourRankName, rp: b.self.rp, isSelf: true },
          listX,
          y,
          listW,
          rowH,
        );
      }
    }

    for (const bt of this.backButtons()) drawButton(ctx, bt);
    ctx.textAlign = 'left';
  }

  /** One seasonal row: rank (medal-tinted for top 3), avatar, name, RP. */
  private drawBoardRow(
    row: { rank: number; u: number; name: string; rp: number; isSelf: boolean },
    x: number,
    y: number,
    listW: number,
    rowH: number,
  ): void {
    const { ctx } = this.vp;
    const medal = row.rank <= 3 ? Game.MEDALS[row.rank - 1]! : null;
    const my = y + (rowH - 6) / 2;
    roundRectPath(ctx, x, y, listW, rowH - 6, 10);
    ctx.fillStyle = row.isSelf
      ? 'rgba(245,196,81,0.14)'
      : medal
        ? `${medal}22`
        : 'rgba(23,31,58,0.7)';
    ctx.fill();
    if (row.isSelf || medal) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = row.isSelf ? 'rgba(245,196,81,0.6)' : `${medal}66`;
      ctx.stroke();
    }
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = medal ?? (row.isSelf ? colors.rebateGold : colors.textMuted);
    ctx.font = `${fonts.weight.black} 13px ${fonts.family}`;
    ctx.fillText(row.rank <= 3 ? Game.MEDAL_ICONS[row.rank - 1]! : `${row.rank}`, x + 12, my);
    // Avatar (skip the synthetic pinned self row that has no real uid=0).
    let nameX = x + 40;
    if (row.u > 0) {
      this.drawAvatarCircle(x + 46, my, 12, row.u, row.name, medal ?? colors.border);
      nameX = x + 66;
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.semibold} 13px ${fonts.family}`;
    ctx.fillText(this.ellipsize(row.name, 14), nameX, my);
    ctx.textAlign = 'right';
    ctx.fillStyle = colors.rebateGold;
    ctx.font = `${fonts.weight.bold} 13px ${fonts.family}`;
    ctx.fillText(`${row.rp.toLocaleString('en-US')}`, x + listW - 12, my);
    ctx.textBaseline = 'alphabetic';
  }

  /** Circular avatar (cached photo or initial-letter fallback — never broken). */
  private drawAvatarCircle(x: number, y: number, r: number, u: number, name: string, ring: string): void {
    const { ctx } = this.vp;
    const img = this.avatarFor(u);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = colors.surface;
    ctx.fill();
    ctx.clip();
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = ring;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = colors.text;
      ctx.font = `${fonts.weight.black} ${r}px ${fonts.family}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((name[0] ?? '?').toUpperCase(), x, y + 1);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = ring;
    ctx.stroke();
    ctx.textBaseline = 'alphabetic';
  }

  private ellipsize(s: string, max: number): string {
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }

  /** Prizes sheet (PRD §5.D): 100/90/80% shares, eligibility floor, terms. */
  private renderPrizes(): void {
    const { ctx, w, h } = this.vp;
    const cx = w / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.black} ${Math.min(w * 0.07, 26)}px ${fonts.family}`;
    ctx.fillText(COPY.prizesTitle, cx, h * 0.12);

    let y = h * 0.22;
    const cardW = Math.min(w * 0.84, 360);
    const cardX = cx - cardW / 2;
    COPY.prizeLines.forEach((line, i) => {
      const ch = 44;
      roundRectPath(ctx, cardX, y, cardW, ch, 12);
      ctx.fillStyle = `${Game.MEDALS[i]!}1e`;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `${Game.MEDALS[i]!}66`;
      ctx.stroke();
      ctx.fillStyle = colors.text;
      ctx.font = `${fonts.weight.bold} 14px ${fonts.family}`;
      ctx.textAlign = 'center';
      ctx.fillText(line, cx, y + ch / 2 + 5);
      y += ch + 10;
    });

    y += 6;
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.medium} 12px ${fonts.family}`;
    const lines = [COPY.prizeDefinition, COPY.prizeFloor, COPY.prizeClaim, COPY.prizeTokensNote];
    for (const para of lines) {
      const wrapped = wrapText(ctx, para, Math.min(w * 0.84, 350));
      wrapped.forEach((ln) => {
        ctx.fillText(ln, cx, y);
        y += 15;
      });
      y += 6;
    }

    // The funnel: link your RebateGain account (only when launched from the bot).
    if (this.account) {
      const cta = this.prizeLinkCtaRect();
      drawButton(ctx, {
        id: 'link',
        ...cta,
        label: this.account.masked ? COPY.accountLinked : COPY.prizeLinkCta,
        kind: this.account.masked ? 'ghost' : 'primary',
      });
    }

    for (const bt of this.backButtons()) drawButton(ctx, bt);
    ctx.textAlign = 'left';
  }

  /** Title-screen account chip: "Link your account" / "✓ Account linked". */
  private renderAccountChip(): void {
    const { ctx } = this.vp;
    const r = this.accountChipRect();
    const linked = !!this.account?.masked;
    roundRectPath(ctx, r.x, r.y, r.w, r.h, r.h / 2);
    ctx.fillStyle = linked ? 'rgba(22,199,132,0.1)' : 'rgba(10,120,255,0.12)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = linked ? 'rgba(22,199,132,0.5)' : 'rgba(10,120,255,0.55)';
    ctx.stroke();
    ctx.fillStyle = linked ? colors.up : colors.text;
    ctx.font = `${fonts.weight.semibold} 12px ${fonts.family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(linked ? COPY.accountLinked : COPY.linkAccount, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
  }

  /** The email-capture screen. A real HTML <input> is overlaid (EmailOverlay);
   *  everything else is canvas. */
  private renderEmail(): void {
    const { ctx, w, h } = this.vp;
    const cx = w / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = colors.text;
    ctx.font = `${fonts.weight.black} ${Math.min(w * 0.06, 24)}px ${fonts.family}`;
    ctx.fillText(COPY.emailTitle, cx, h * 0.16);

    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fonts.weight.medium} 13px ${fonts.family}`;
    wrapText(ctx, COPY.emailIntro, Math.min(w * 0.84, 350)).forEach((ln, i) =>
      ctx.fillText(ln, cx, h * 0.24 + i * 18),
    );

    // Current linked email, if any.
    if (this.account?.masked) {
      ctx.fillStyle = colors.up;
      ctx.font = `${fonts.weight.bold} 13px ${fonts.family}`;
      ctx.fillText(`✓ ${this.account.masked}`, cx, h * 0.38);
      ctx.fillStyle = colors.textMuted;
      ctx.font = `${fonts.weight.medium} 11px ${fonts.family}`;
      ctx.fillText(COPY.emailChangesLeft(this.account.changesLeft), cx, h * 0.38 + 16);
    }

    // The input frame is drawn to match the overlaid HTML input's rect.
    const ir = this.emailInputRect();
    roundRectPath(ctx, ir.x, ir.y, ir.w, ir.h, 10);
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Validation message / "did you mean" suggestion.
    if (this.emailSuggestion) {
      const sr = this.emailSuggestionRect();
      ctx.fillStyle = colors.rebateGold;
      ctx.font = `${fonts.weight.semibold} 12px ${fonts.family}`;
      ctx.fillText(COPY.emailDidYouMean(this.emailSuggestion), cx, sr.y + 14);
    } else if (this.emailMsg) {
      ctx.fillStyle = this.emailMsg.kind === 'ok' ? colors.up : colors.down;
      ctx.font = `${fonts.weight.semibold} 12px ${fonts.family}`;
      wrapText(ctx, this.emailMsg.text, Math.min(w * 0.84, 350)).forEach((ln, i) =>
        ctx.fillText(ln, cx, this.emailSuggestionRect().y + 14 + i * 15),
      );
    }

    for (const b of this.emailButtons()) {
      if (b.id === 'save' && this.emailSaving) {
        drawButton(ctx, { ...b, label: COPY.rpPending });
      } else {
        drawButton(ctx, b);
      }
    }

    // "Create an account" link + binding privacy line.
    const crr = this.emailCreateRect();
    ctx.fillStyle = colors.rebateGold;
    ctx.font = `${fonts.weight.semibold} 12px ${fonts.family}`;
    ctx.fillText(COPY.emailNoAccount, cx, crr.y + 14);

    ctx.fillStyle = 'rgba(138,148,166,0.85)';
    ctx.font = `${fonts.weight.medium} 11px ${fonts.family}`;
    wrapText(ctx, COPY.emailPrivacy, Math.min(w * 0.84, 350)).forEach((ln, i) =>
      ctx.fillText(ln, cx, h * 0.76 + i * 14),
    );

    for (const bt of this.backButtons()) drawButton(ctx, bt);
    ctx.textAlign = 'left';
  }

  private renderLegacyBoard(): void {
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

    if (this.leaderboardError) {
      ctx.fillStyle = colors.down;
      ctx.font = `${fonts.weight.semibold} 13px ${fonts.family}`;
      wrapText(ctx, COPY.lbError, Math.min(w * 0.82, 340)).forEach((ln, i) =>
        ctx.fillText(ln, cx, y + 30 + i * 18),
      );
    } else if (this.leaderboardLoading || this.leaderboard.length === 0) {
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
