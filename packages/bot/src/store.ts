import { existsSync, copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE_ROUNDS,
  DAILY_TOKENS,
  computeRp,
  dayKey,
  dayStreakMultiplier,
  nextRefillAt,
  seasonEndsAt,
  seasonOf,
  type LevelId,
  type OppKind,
  type RpBreakdown,
} from './rp';
import {
  DAILY_POOL_IDS,
  DEFAULT_TASKS,
  REFERRAL_TOKEN_CAP,
  clampReward,
  type TaskDef,
  type RewardType,
  type VerifyMethod,
} from './taskCatalog';

/**
 * Seasonal store — PRD-SCORING-TOKENS §8.1, Phase A.
 *
 * Persistence is a single JSON file with atomic writes (tmp + rename), NOT
 * better-sqlite3: the VPS deploy runs `npm ci` unattended and a native-module
 * build failure would take production down with no SSH recovery path. The bot is
 * a single pm2 instance (deploy concurrency guarantees it), so single-process
 * mutation + atomic persistence gives the same guarantees the PRD wants from
 * SQLite at this scale. The shapes below mirror the PRD tables 1:1, so a later
 * SQLite swap is mechanical.
 *
 * Season close (PRD §8.4) runs lazily on the first store access after a month
 * boundary — idempotent, safe on restart, no cron needed. Token refills are
 * stateless: remaining = 10 − spent(todayKey) + refunds (PRD §5.A note).
 */

// ---- shapes (mirror PRD §8.1 tables) ---------------------------------------

interface UserRec {
  name: string;
  /** Consecutive-day play streak; updated on the first ranked match of a UTC day. */
  streakDays: number;
  lastPlayedDay: string; // UTC YYYY-MM-DD
  /** Consecutive ranked duel wins (resets on a duel loss). */
  winStreak: number;
  // Account linkage for prize delivery (PRD-ADMIN-EMAIL §5). The email is a
  // matching HINT (no verification in v1), stored as typed; `emailNormalized`
  // exists only for duplicate detection.
  email?: string;
  emailNormalized?: string;
  emailSetAt?: number;
  /** Email changes within `emailChangesSeason` (max 3/season — PRD §5.3). */
  emailChanges?: number;
  emailChangesSeason?: string;
  /** Back-office account id once an operator matches the email (PRD §6.4). */
  rgAccountRef?: string;
  banned?: boolean;
  /** Free-form operator notes shown in the player drawer. */
  adminNote?: string;
  // Onboarding (PRD-ONBOARDING-TASKS §5). tutorialDone survives reinstalls.
  tutorialDone?: boolean;
  tutorialSkipped?: boolean;
  /** Contextual one-time tooltips already seen (screen keys). */
  seenTips?: string[];
  /** Who invited this player (referral attribution) + whether we've credited them. */
  referredBy?: number;
  refCredited?: boolean;
}

export interface ScoreRec {
  u: number;
  name: string;
  rp: number;
  matches: number;
  /** Ranked duel wins (tie-break №2). */
  wins: number;
  correct: number;
  rounds: number;
  lastRpAt: number;
}

export interface HofEntry {
  rank: number;
  u: number;
  name: string;
  rp: number;
  /** Season match count — preserved in finalStandings so roll-down can re-check
   *  the eligibility floor after scores reset (undefined in the podium's top 3). */
  matches?: number;
}

export interface PrizeRec {
  rank: number;
  u: number;
  name: string;
  sharePct: number;
  state: 'pending' | 'linked' | 'applied' | 'expired';
  // Prize-workflow fields written by the admin panel (PRD-ADMIN-EMAIL §6.4).
  appliedBy?: string;
  appliedAt?: number;
  /** The share % actually set in the back office (may differ from sharePct). */
  shareApplied?: number;
  effectiveFrom?: number;
  effectiveUntil?: number;
  backofficeRef?: string;
  rolledDownReason?: string;
}

interface TokenDay {
  spent: number;
  refunded: number;
  /** Earned bonus tokens (from tasks) — capped at MAX_BONUS_TOKENS/day (PRD §5.A). */
  bonus?: number;
}
const MAX_BONUS_TOKENS = 5;

/** One appended email-change record (append-only — PRD §5.3). */
export interface EmailHistoryRec {
  id: string;
  u: number;
  email: string;
  setAt: number;
  source: 'game' | 'admin';
}

/** One ranked-match record for the admin drawer + anomaly heuristics (PRD §6.4). */
export interface MatchLogRec {
  id: string;
  u: number;
  season: string;
  ts: number;
  level: string;
  mode: string;
  oppKind: string;
  correctBase: number;
  roundsPlayed: number;
  rp: number;
  /** Mean decision time (ms) over the scored rounds — for speed_outlier. */
  avgMs: number;
}

/** An advisory anomaly flag (PRD §6.3). Never auto-bans; a human decides. */
export interface FlagRec {
  id: string;
  u: number;
  seasonId: string;
  kind: string;
  evidence: string;
  state: 'open' | 'cleared' | 'actioned';
  createdAt: number;
  resolvedBy?: string;
  resolvedAt?: number;
}

/** An append-only audit entry for every mutating admin action (PRD §6.1). */
export interface AuditRec {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  note?: string;
  ts: number;
}

interface AdminSession {
  admin: string;
  createdAt: number;
  expiresAt: number;
  ip: string;
}

interface State {
  activeSeason: string;
  users: Record<string, UserRec>;
  /** Active season's cumulative scores, keyed by user id. */
  scores: Record<string, ScoreRec>;
  /** Previous seasons' top 3, keyed by season id (PRD §5.C Hall of Fame). */
  hallOfFame: Record<string, HofEntry[]>;
  /** Deeper final standings per closed season (top 20) — powers prize roll-down
   *  to rank 4+ and the admin closed-season standings view. */
  finalStandings: Record<string, HofEntry[]>;
  prizes: Record<string, PrizeRec[]>;
  /** Token ledger, keyed `${day}:${u}` — old days pruned lazily. */
  tokens: Record<string, TokenDay>;
  /** Consumed single-use match tokens (matchId → consumed-at), pruned after 24h. */
  consumed: Record<string, number>;
  // ---- PRD-ADMIN-EMAIL additions ----
  emailHistory: EmailHistoryRec[];
  matchLog: MatchLogRec[];
  flags: FlagRec[];
  auditLog: AuditRec[];
  /** Admin session cookies, keyed by opaque token. */
  adminSessions: Record<string, AdminSession>;
  // ---- PRD-ONBOARDING-TASKS additions ----
  /** Editable task catalog (seeded from DEFAULT_TASKS on first boot). */
  taskCatalog: TaskDef[];
  /** Server-picked daily task ids, keyed by UTC day (same 3 for everyone). */
  dailyRotation: Record<string, string[]>;
  /** Per-user task progress, keyed `${u}:${taskId}:${day|'-'}`. */
  taskProgress: Record<string, TaskProgressRec>;
  /** Click-claim visit timestamps, keyed `${u}:${taskId}` (30s unlock). */
  taskVisits: Record<string, number>;
}

interface TaskProgressRec {
  state: 'in_progress' | 'pending' | 'completed' | 'claimed';
  progress: number;
  completedAt?: number;
  claimedAt?: number;
}

/** Keep the global match log bounded (JSON in memory; small game). */
const MATCH_LOG_CAP = 20_000;
const AUDIT_CAP = 20_000;

const rid = (n: number): string => randomBytes(n).toString('hex');

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.data');
const FILE = join(DATA_DIR, 'seasons.json');

/** Prize shares by final rank (PRD §5.D — rebate share % for the next month). */
export const PRIZE_SHARES = [100, 90, 80] as const;
/** Prize eligibility floor: ≥ 20 ranked matches in the season (PRD §5.C). */
export const ELIGIBILITY_FLOOR = 20;

const state: State = load();

function load(): State {
  try {
    if (existsSync(FILE)) {
      // Migrate older files that predate the ADMIN-EMAIL fields (?? per array).
      const s = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<State>;
      return {
        activeSeason: s.activeSeason ?? seasonOf(),
        users: s.users ?? {},
        scores: s.scores ?? {},
        hallOfFame: s.hallOfFame ?? {},
        finalStandings: s.finalStandings ?? {},
        prizes: s.prizes ?? {},
        tokens: s.tokens ?? {},
        consumed: s.consumed ?? {},
        emailHistory: s.emailHistory ?? [],
        matchLog: s.matchLog ?? [],
        flags: s.flags ?? [],
        auditLog: s.auditLog ?? [],
        adminSessions: s.adminSessions ?? {},
        taskCatalog: s.taskCatalog?.length ? s.taskCatalog : DEFAULT_TASKS.map((t) => ({ ...t })),
        dailyRotation: s.dailyRotation ?? {},
        taskProgress: s.taskProgress ?? {},
        taskVisits: s.taskVisits ?? {},
      };
    }
  } catch {
    /* corrupt file → fresh start; the old file survives as .bak below */
    try {
      copyFileSync(FILE, `${FILE}.bak`);
    } catch {
      /* non-fatal */
    }
  }
  // First boot: back up the legacy best-score board as the read-only "preseason"
  // artifact (PRD §8.5 — no scores carry over; fresh start is the point).
  try {
    const legacy = join(DATA_DIR, 'leaderboard.json');
    if (existsSync(legacy)) copyFileSync(legacy, join(DATA_DIR, 'preseason-backup.json'));
  } catch {
    /* non-fatal */
  }
  return {
    activeSeason: seasonOf(),
    users: {},
    scores: {},
    hallOfFame: {},
    finalStandings: {},
    prizes: {},
    tokens: {},
    consumed: {},
    emailHistory: [],
    matchLog: [],
    flags: [],
    auditLog: [],
    adminSessions: {},
    taskCatalog: DEFAULT_TASKS.map((t) => ({ ...t })),
    dailyRotation: {},
    taskProgress: {},
    taskVisits: {},
  };
}

function save(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, FILE); // atomic on the same filesystem
  } catch (e) {
    console.error('[store] save failed:', e);
  }
}

// ---- season lifecycle (PRD §5.C / §8.4) ------------------------------------

export interface SeasonCloseInfo {
  seasonId: string;
  hallOfFame: HofEntry[];
  prizes: PrizeRec[];
}

let closeListener: ((info: SeasonCloseInfo) => void) | null = null;
/** The bot subscribes here to notify winners on season close (PRD Story 5). */
export function onSeasonClose(fn: (info: SeasonCloseInfo) => void): void {
  closeListener = fn;
}

/** Final-standings sort (PRD §5.C tie-break):
 *  RP → PvP wins → accuracy → fewer matches → earlier final-RP timestamp. */
function standingsSort(a: ScoreRec, b: ScoreRec): number {
  if (b.rp !== a.rp) return b.rp - a.rp;
  if (b.wins !== a.wins) return b.wins - a.wins;
  const accA = a.rounds > 0 ? a.correct / a.rounds : 0;
  const accB = b.rounds > 0 ? b.correct / b.rounds : 0;
  if (accB !== accA) return accB - accA;
  if (a.matches !== b.matches) return a.matches - b.matches;
  return a.lastRpAt - b.lastRpAt;
}

/** Live-board sort: RP, then earlier timestamp (stable within the running month). */
function liveSort(a: ScoreRec, b: ScoreRec): number {
  return b.rp - a.rp || a.lastRpAt - b.lastRpAt;
}

/** Close the season if the month rolled over. Idempotent; call before any read/write. */
function ensureSeason(): void {
  const current = seasonOf();
  if (state.activeSeason === current) return;

  const closing = state.activeSeason;
  const standings = Object.values(state.scores).sort(standingsSort);
  const rank = (arr: ScoreRec[]): HofEntry[] =>
    arr.map((s, i) => ({ rank: i + 1, u: s.u, name: s.name, rp: s.rp, matches: s.matches }));
  const hof = rank(standings.slice(0, 3));
  // Deeper snapshot so a prize can roll down to rank 4+ after close (PRD §6.4).
  const finals = rank(standings.slice(0, 20));
  // Prizes go to the top 3 AMONG ELIGIBLE players (≥ floor matches — PRD §5.C).
  const prizes: PrizeRec[] = standings
    .filter((s) => s.matches >= ELIGIBILITY_FLOOR)
    .slice(0, PRIZE_SHARES.length)
    .map((s, i) => ({ rank: i + 1, u: s.u, name: s.name, sharePct: PRIZE_SHARES[i]!, state: 'pending' }));

  state.hallOfFame[closing] = hof;
  state.finalStandings[closing] = finals;
  state.prizes[closing] = prizes;
  state.scores = {};
  state.activeSeason = current;

  // Ops report for the manual back-office prize application (PRD §5.D Phase A).
  try {
    writeFileSync(
      join(DATA_DIR, `season-${closing}-report.json`),
      JSON.stringify({ seasonId: closing, generatedAt: new Date().toISOString(), prizes, standings: standings.slice(0, 50) }, null, 2),
    );
  } catch (e) {
    console.error('[store] season report failed:', e);
  }
  save();
  console.log(`[season] closed ${closing} → top3 ${hof.map((h) => h.name).join(', ') || '(empty)'} · season ${current} open`);
  if (closeListener) closeListener({ seasonId: closing, hallOfFame: hof, prizes });
}

// ---- tokens (PRD §5.A) ------------------------------------------------------

function tokenDay(u: number, day: string): TokenDay {
  const key = `${day}:${u}`;
  let t = state.tokens[key];
  if (!t) {
    t = { spent: 0, refunded: 0 };
    state.tokens[key] = t;
  }
  return t;
}

/** Lazy prune: only today + yesterday matter (refunds can target yesterday's spend). */
function pruneTokens(): void {
  const today = dayKey();
  const yesterday = dayKey(Date.now() - 86_400_000);
  for (const key of Object.keys(state.tokens)) {
    const day = key.slice(0, 10);
    if (day !== today && day !== yesterday) delete state.tokens[key];
  }
}

export function tokensRemaining(u: number): number {
  ensureSeason();
  const t = state.tokens[`${dayKey()}:${u}`];
  if (!t) return DAILY_TOKENS;
  const cap = DAILY_TOKENS + MAX_BONUS_TOKENS;
  return Math.max(0, Math.min(cap, DAILY_TOKENS + (t.bonus ?? 0) - t.spent + t.refunded));
}

/** Grant earned bonus tokens (from a task), capped at +5/day. Returns count granted. */
export function grantBonusToken(u: number, n: number): number {
  ensureSeason();
  const t = tokenDay(u, dayKey());
  const have = t.bonus ?? 0;
  const add = Math.max(0, Math.min(n, MAX_BONUS_TOKENS - have));
  t.bonus = have + add;
  save();
  return add;
}

/** Atomically spend one token; returns the new remaining count or null if broke. */
export function spendToken(u: number): number | null {
  ensureSeason();
  pruneTokens();
  const remaining = tokensRemaining(u);
  if (remaining <= 0) return null;
  tokenDay(u, dayKey()).spent++;
  save();
  return remaining - 1;
}

/** Refund a token spent on `spentDay` (match died before round 1 — PRD §5.A). */
export function refundToken(u: number, spentDay: string): number {
  ensureSeason();
  const t = tokenDay(u, spentDay);
  if (t.refunded < t.spent) t.refunded++;
  save();
  return tokensRemaining(u);
}

// ---- daily streak (PRD §5.B / Story 6) --------------------------------------

function userRec(u: number, name?: string): UserRec {
  let rec = state.users[String(u)];
  if (!rec) {
    rec = { name: name ?? 'Player', streakDays: 0, lastPlayedDay: '', winStreak: 0 };
    state.users[String(u)] = rec;
  }
  if (name) rec.name = name;
  return rec;
}

/** Increment the daily streak on the first ranked match of a UTC day. */
export function touchDailyStreak(u: number, name?: string): void {
  ensureSeason();
  const rec = userRec(u, name);
  const today = dayKey();
  if (rec.lastPlayedDay === today) return;
  const yesterday = dayKey(Date.now() - 86_400_000);
  rec.streakDays = rec.lastPlayedDay === yesterday ? rec.streakDays + 1 : 1;
  rec.lastPlayedDay = today;
  save();
}

/** The streak the player HAS (or would extend to by playing right now) — for display. */
function effectiveStreak(rec: UserRec): number {
  const today = dayKey();
  if (rec.lastPlayedDay === today) return rec.streakDays;
  if (rec.lastPlayedDay === dayKey(Date.now() - 86_400_000)) return rec.streakDays + 1;
  return 1;
}

// ---- match tokens: single-use enforcement (PRD §8.3) ------------------------

export function isConsumed(matchId: string): boolean {
  ensureSeason();
  return matchId in state.consumed;
}

export function consume(matchId: string): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, ts] of Object.entries(state.consumed)) if (ts < cutoff) delete state.consumed[id];
  state.consumed[matchId] = Date.now();
  save();
}

// ---- scoring (PRD §5.B / Story 2) -------------------------------------------

export interface ResultInput {
  u: number;
  name: string;
  level: LevelId;
  /** Correct calls among the first BASE_ROUNDS (server-validated). */
  correctBase: number;
  /** Rounds actually played (≤ BASE_ROUNDS counted toward stats). */
  roundsPlayed: number;
  won: boolean;
  oppKind: OppKind;
  /** Match mode (quick/live/duel) for the match log. */
  mode?: string;
  /** Mean decision time (ms) over scored rounds — for the speed_outlier flag. */
  avgMs?: number;
}

export interface ResultOutcome {
  rp: number;
  breakdown: RpBreakdown;
  seasonRp: number;
  rank: number;
  rankDelta: number;
}

export function applyResult(input: ResultInput): ResultOutcome {
  ensureSeason();
  const rec = userRec(input.u, input.name);

  // Win-streak: consecutive ranked duel wins; a duel loss resets it (PRD §5.B).
  const isDuel = input.oppKind === 'human' || input.oppKind === 'ai';
  if (isDuel) rec.winStreak = input.won ? rec.winStreak + 1 : 0;

  const streakDays = rec.lastPlayedDay === dayKey() ? Math.max(1, rec.streakDays) : 1;
  const breakdown = computeRp(
    input.level,
    input.correctBase,
    input.won,
    input.oppKind,
    rec.winStreak,
    streakDays,
  );

  const rankBefore = rankOf(input.u);
  let s = state.scores[String(input.u)];
  if (!s) {
    s = { u: input.u, name: input.name, rp: 0, matches: 0, wins: 0, correct: 0, rounds: 0, lastRpAt: 0 };
    state.scores[String(input.u)] = s;
  }
  s.name = input.name || s.name;
  s.rp += breakdown.total;
  s.matches += 1;
  if (isDuel && input.won) s.wins += 1;
  s.correct += input.correctBase;
  s.rounds += Math.min(BASE_ROUNDS, input.roundsPlayed);
  s.lastRpAt = Date.now();

  // Match log for the admin drawer + anomaly heuristics (bounded ring — PRD §6.4).
  state.matchLog.push({
    id: rid(6),
    u: input.u,
    season: state.activeSeason,
    ts: Date.now(),
    level: input.level,
    mode: input.mode ?? 'quick',
    oppKind: input.oppKind,
    correctBase: input.correctBase,
    roundsPlayed: Math.min(BASE_ROUNDS, input.roundsPlayed),
    rp: breakdown.total,
    avgMs: Math.max(0, Math.round(input.avgMs ?? 0)),
  });
  if (state.matchLog.length > MATCH_LOG_CAP) state.matchLog.splice(0, state.matchLog.length - MATCH_LOG_CAP);
  save();

  const rank = rankOf(input.u);
  return {
    rp: breakdown.total,
    breakdown,
    seasonRp: s.rp,
    rank,
    rankDelta: rankBefore > 0 ? rankBefore - rank : 0,
  };
}

function rankOf(u: number): number {
  const sorted = Object.values(state.scores).sort(liveSort);
  const i = sorted.findIndex((s) => s.u === u);
  return i < 0 ? 0 : i + 1;
}

// ---- reads ------------------------------------------------------------------

export interface ProfileView {
  tokens: number;
  refillAt: number;
  streakDays: number;
  multiplier: number;
  season: { id: string; endsAt: number };
  rp: number;
  rank: number;
}

export function profileOf(u: number, name?: string): ProfileView {
  ensureSeason();
  const rec = userRec(u, name);
  const streak = effectiveStreak(rec);
  const s = state.scores[String(u)];
  return {
    tokens: tokensRemaining(u),
    refillAt: Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate() + 1,
    ),
    streakDays: streak,
    multiplier: dayStreakMultiplier(streak),
    season: { id: state.activeSeason, endsAt: seasonEndsAt(state.activeSeason) },
    rp: s?.rp ?? 0,
    rank: s ? rankOf(u) : 0,
  };
}

export interface BoardView {
  season: { id: string; endsAt: number };
  hallOfFame: HofEntry[];
  rows: Array<{ rank: number; u: number; name: string; rp: number; isSelf: boolean }>;
  self: { rank: number; rp: number } | null;
}

export function boardOf(u: number, limit = 50): BoardView {
  ensureSeason();
  const sorted = Object.values(state.scores).sort(liveSort);
  const prevSeason = previousSeasonId(state.activeSeason);
  const selfIdx = sorted.findIndex((s) => s.u === u);
  return {
    season: { id: state.activeSeason, endsAt: seasonEndsAt(state.activeSeason) },
    hallOfFame: state.hallOfFame[prevSeason] ?? [],
    rows: sorted
      .slice(0, limit)
      .map((s, i) => ({ rank: i + 1, u: s.u, name: s.name, rp: s.rp, isSelf: s.u === u })),
    self: selfIdx >= 0 ? { rank: selfIdx + 1, rp: sorted[selfIdx]!.rp } : null,
  };
}

export function previousSeasonId(seasonId: string): string {
  const y = Number(seasonId.slice(0, 4));
  const m = Number(seasonId.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Display name for a user id (falls back to "Player"). */
export function userName(u: number): string {
  return state.users[String(u)]?.name ?? 'Player';
}

// ============================================================================
// PRD-ONBOARDING-TASKS — onboarding flags + task system
// ============================================================================

// ---- onboarding (tutorial + tooltips, §5) ----------------------------------

export interface OnboardingView {
  tutorialDone: boolean;
  tutorialSkipped: boolean;
  seenTips: string[];
}

export function onboardingOf(u: number, name?: string): OnboardingView {
  ensureSeason();
  const rec = userRec(u, name);
  return {
    tutorialDone: rec.tutorialDone ?? false,
    tutorialSkipped: rec.tutorialSkipped ?? false,
    seenTips: rec.seenTips ?? [],
  };
}

export function setTutorial(u: number, name: string, done: boolean, skipped: boolean): void {
  ensureSeason();
  const rec = userRec(u, name);
  if (done) rec.tutorialDone = true;
  if (skipped) rec.tutorialSkipped = true;
  save();
}

export function markTipSeen(u: number, tip: string): void {
  const rec = userRec(u);
  const tips = rec.seenTips ?? [];
  if (!tips.includes(tip)) {
    tips.push(tip);
    rec.seenTips = tips;
    save();
  }
}

/** A brand-new player (no tutorial flags and no matches) should see the FTUE. */
export function isNewPlayer(u: number): boolean {
  const rec = state.users[String(u)];
  if (!rec) return true;
  if (rec.tutorialDone || rec.tutorialSkipped) return false;
  return (state.scores[String(u)]?.matches ?? 0) === 0;
}

// ---- task helpers -----------------------------------------------------------

const pkey = (u: number, taskId: string, day?: string): string => `${u}:${taskId}:${day ?? '-'}`;

function taskDef(id: string): TaskDef | undefined {
  return state.taskCatalog.find((t) => t.id === id);
}

function getProg(u: number, taskId: string, day?: string): TaskProgressRec {
  const k = pkey(u, taskId, day);
  let r = state.taskProgress[k];
  if (!r) {
    r = { state: 'in_progress', progress: 0 };
    state.taskProgress[k] = r;
  }
  return r;
}

function bump(u: number, taskId: string, day: string | undefined, to: number, target: number): void {
  const r = getProg(u, taskId, day);
  if (r.state === 'claimed') return;
  r.progress = Math.min(target, Math.max(r.progress, to));
  if (r.progress >= target && r.state === 'in_progress') {
    r.state = 'completed';
    r.completedAt = Date.now();
  }
}

// ---- daily rotation (§7.3 — same 3 for everyone, snapshot per day) ----------

function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function dailyTaskIds(day: string): string[] {
  if (state.dailyRotation[day]) return state.dailyRotation[day]!;
  const pool = state.taskCatalog.filter((t) => t.cadence === 'daily' && t.active).map((t) => t.id);
  // Deterministic shuffle from the day → same 3 for all players.
  let s = strHash(day) || 1;
  const rng = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  const picked = arr.slice(0, 3);
  state.dailyRotation[day] = picked;
  // Prune rotations older than yesterday.
  const keep = new Set([day, dayKey(Date.now() - 86_400_000)]);
  for (const d of Object.keys(state.dailyRotation)) if (!keep.has(d)) delete state.dailyRotation[d];
  save();
  return picked;
}

// ---- RP grant for a task (source: task, §7.4) -------------------------------

function grantTaskRp(u: number, name: string, rp: number): { seasonRp: number; rank: number } {
  let sc = state.scores[String(u)];
  if (!sc) {
    sc = { u, name, rp: 0, matches: 0, wins: 0, correct: 0, rounds: 0, lastRpAt: 0 };
    state.scores[String(u)] = sc;
  }
  sc.rp += rp;
  sc.lastRpAt = Date.now();
  state.matchLog.push({
    id: rid(6),
    u,
    season: state.activeSeason,
    ts: Date.now(),
    level: '-',
    mode: 'task',
    oppKind: 'task',
    correctBase: 0,
    roundsPlayed: 0,
    rp,
    avgMs: 0,
  });
  if (state.matchLog.length > MATCH_LOG_CAP) state.matchLog.splice(0, state.matchLog.length - MATCH_LOG_CAP);
  save();
  return { seasonRp: sc.rp, rank: rankOf(u) };
}

// ---- gameplay auto-progress (§7.3 / §7.7) -----------------------------------

export interface TaskMatchEvent {
  mode: string; // quick | live | duel
  level: LevelId;
  correctBase: number;
  won: boolean;
  oppKind: OppKind;
  /** Correct calls on forex charts this match (client-provided hint for d_forex). */
  forexCorrect: number;
}

/** Advance gameplay tasks from a ranked match result (server-authoritative). */
export function progressTasks(u: number, name: string, ev: TaskMatchEvent): void {
  ensureSeason();
  userRec(u, name);
  const day = dayKey();
  const isDuel = ev.oppKind === 'human' || ev.oppKind === 'ai';

  // One-time gameplay milestones.
  if (ev.mode === 'live' || ev.mode === 'duel') bump(u, 'first_duel', undefined, 1, 1);
  if (ev.won && ev.oppKind === 'human') bump(u, 'first_human_win', undefined, 1, 1);

  // Today's 3 daily tasks only.
  const today = dailyTaskIds(day);
  const spent = state.tokens[`${day}:${u}`]?.spent ?? 0;
  for (const id of today) {
    const def = taskDef(id);
    if (!def) continue;
    const p = getProg(u, id, day);
    const cur = p.progress;
    switch (id) {
      case 'd_play3':
        if (ev.mode !== 'free') bump(u, id, day, cur + 1, def.target);
        break;
      case 'd_win':
        if (ev.won && isDuel) bump(u, id, day, def.target, def.target);
        break;
      case 'd_pro_whale':
        if (ev.level === 'pro' || ev.level === 'whale') bump(u, id, day, cur + ev.correctBase, def.target);
        break;
      case 'd_score4':
        if (ev.correctBase >= 4) bump(u, id, day, def.target, def.target);
        break;
      case 'd_forex':
        if (ev.forexCorrect >= 3) bump(u, id, day, def.target, def.target);
        break;
      case 'd_spend':
        bump(u, id, day, spent, def.target);
        break;
      default:
        break;
    }
  }
  // Credit the inviter the first time this player completes a match (referral).
  creditReferral(u);
}

/** Client signals a result-card share for the d_share daily task. */
export function shareTaskEvent(u: number, name: string): void {
  ensureSeason();
  userRec(u, name);
  const day = dayKey();
  if (dailyTaskIds(day).includes('d_share')) bump(u, 'd_share', day, 1, 1);
}

// ---- referral (§7.2) --------------------------------------------------------

export function recordReferral(inviteeU: number, inviterU: number): void {
  if (inviteeU === inviterU) return;
  const rec = userRec(inviteeU);
  if (rec.referredBy === undefined) {
    rec.referredBy = inviterU;
    save();
  }
}

/** On the invitee's first completed match, credit the inviter +1 token (cap 5). */
function creditReferral(inviteeU: number): void {
  const rec = state.users[String(inviteeU)];
  if (!rec || rec.refCredited || rec.referredBy === undefined) return;
  rec.refCredited = true;
  const inviter = rec.referredBy;
  const p = getProg(inviter, 'referral', undefined);
  if (p.progress < REFERRAL_TOKEN_CAP) {
    p.progress += 1;
    grantBonusToken(inviter, 1);
    if (p.progress >= REFERRAL_TOKEN_CAP) {
      p.state = 'claimed';
      p.claimedAt = Date.now();
    }
  }
  save();
}

// ---- link-visit tracking (§7.5) ---------------------------------------------

const CLICK_CLAIM_DELAY_MS = 30_000;

/** Record that the player opened a task's link. click_claim starts its 30s unlock
 *  timer; tg_member records the "Join" step so the UI can switch to Claim.
 *  Returns when the Claim button unlocks (now for tg — membership is the real gate). */
export function visitTask(u: number, taskId: string): number | null {
  const def = taskDef(taskId);
  if (!def || (def.verifyMethod !== 'click_claim' && def.verifyMethod !== 'tg_member')) return null;
  const now = Date.now();
  state.taskVisits[`${u}:${taskId}`] = now;
  save();
  return def.verifyMethod === 'click_claim' ? now + CLICK_CLAIM_DELAY_MS : now;
}

// ---- completion state resolution --------------------------------------------

export type TaskState = 'locked' | 'in_progress' | 'pending' | 'completed' | 'claimed';

function resolveState(u: number, def: TaskDef, day?: string): { state: TaskState; progress: number } {
  const rec = state.users[String(u)];
  const p = state.taskProgress[pkey(u, def.id, day)];
  if (p?.state === 'claimed') return { state: 'claimed', progress: p.progress };
  if (p?.state === 'pending') return { state: 'pending', progress: p.progress };

  if (def.verifyMethod === 'manual') {
    return { state: (p?.state as TaskState) || 'in_progress', progress: p?.progress ?? 0 };
  }

  // Server-flag tasks derive completion from user state.
  if (def.id === 'tutorial') {
    const done = !!rec?.tutorialDone;
    return { state: done ? 'completed' : 'in_progress', progress: done ? 1 : 0 };
  }
  if (def.id === 'email_link') {
    const done = !!rec?.email;
    return { state: done ? 'completed' : 'in_progress', progress: done ? 1 : 0 };
  }
  if (def.verifyMethod === 'click_claim') {
    const visited = state.taskVisits[`${u}:${def.id}`];
    const ready = visited && Date.now() - visited >= CLICK_CLAIM_DELAY_MS;
    return { state: ready ? 'completed' : 'in_progress', progress: 0 };
  }
  if (def.verifyMethod === 'tg_member') {
    // Membership is verified at claim time; show as claimable-pending.
    return { state: p?.state === 'completed' ? 'completed' : 'in_progress', progress: p?.progress ?? 0 };
  }
  // Gameplay / referral: from stored progress.
  const prog = p?.progress ?? 0;
  const st: TaskState = p?.state === 'completed' || prog >= def.target ? 'completed' : 'in_progress';
  return { state: st, progress: prog };
}

// ---- tasks view (§7.6) ------------------------------------------------------

export interface TaskRow {
  id: string;
  kind: string;
  title: string;
  rewardType: string;
  rewardAmount: number;
  verifyMethod: string;
  url?: string;
  target: number;
  state: TaskState;
  progress: number;
  /** Whether the player already opened this task's link (Join/Go pressed). */
  visited?: boolean;
  /** click_claim only: when the Claim button unlocks (visited, timer running). */
  unlocksAt?: number;
}

export interface TasksView {
  daily: TaskRow[];
  general: TaskRow[];
  resetAt: number;
  claimable: number;
}

function toRow(u: number, def: TaskDef, day?: string): TaskRow {
  const { state: st, progress } = resolveState(u, def, day);
  // Give the client an openable link: the social URL, or a t.me link for TG tasks.
  const url =
    def.url ||
    (def.channel ? `https://t.me/${def.channel.replace(/^@/, '')}` : undefined);
  const visitedAt = state.taskVisits[`${u}:${def.id}`];
  const unlocksAt =
    def.verifyMethod === 'click_claim' && visitedAt && st === 'in_progress'
      ? visitedAt + CLICK_CLAIM_DELAY_MS
      : undefined;
  return {
    id: def.id,
    kind: def.kind,
    title: def.title,
    rewardType: def.rewardType,
    rewardAmount: def.rewardAmount,
    verifyMethod: def.verifyMethod,
    url,
    target: def.target,
    state: st,
    progress,
    visited: visitedAt !== undefined || undefined,
    unlocksAt,
  };
}

export function tasksView(u: number, name?: string): TasksView {
  ensureSeason();
  userRec(u, name);
  const day = dayKey();
  const dailyIds = dailyTaskIds(day);
  const daily = dailyIds
    .map((id) => taskDef(id))
    .filter((d): d is TaskDef => !!d)
    .map((d) => toRow(u, d, day));
  const general = state.taskCatalog
    .filter((t) => t.cadence === 'once' && t.active)
    .sort((a, b) => a.sort - b.sort)
    .map((d) => toRow(u, d));
  const claimable = [...daily, ...general].filter((r) => r.state === 'completed').length;
  return { daily, general, resetAt: nextRefillAt(), claimable };
}

// ---- claim (§7.7) -----------------------------------------------------------

export type ClaimResult =
  | { ok: true; rewardType: string; reward: number; seasonRp?: number; rank?: number; tokens?: number }
  | { ok: false; error: 'already_claimed' | 'not_completed' | 'unknown_task' | 'tg_not_member' | 'pending_approval' };

/** Claim a completed task. `tgVerified` is supplied by the route after a
 *  getChatMember check for tg_member tasks. Idempotent. */
export function claimTask(u: number, name: string, taskId: string, day: string | undefined, tgVerified?: boolean): ClaimResult {
  ensureSeason();
  userRec(u, name);
  const def = taskDef(taskId);
  if (!def || !def.active) return { ok: false, error: 'unknown_task' };
  const dayArg = def.cadence === 'daily' ? (day ?? dayKey()) : undefined;

  const p = getProg(u, taskId, dayArg);
  if (p.state === 'claimed') return { ok: false, error: 'already_claimed' };

  if (def.verifyMethod === 'manual') {
    if (p.state === 'pending') return { ok: false, error: 'pending_approval' };
    return { ok: false, error: 'not_completed' };
  }

  // Completion gates.
  if (def.verifyMethod === 'tg_member') {
    if (!tgVerified) return { ok: false, error: 'tg_not_member' };
  } else {
    const { state: st } = resolveState(u, def, dayArg);
    if (st !== 'completed') return { ok: false, error: 'not_completed' };
  }

  p.state = 'claimed';
  p.claimedAt = Date.now();
  p.progress = Math.max(p.progress, def.target);

  const amount = clampReward(def.rewardType, def.rewardAmount);
  if (def.rewardType === 'token') {
    const granted = grantBonusToken(u, amount);
    save();
    return { ok: true, rewardType: 'token', reward: granted, tokens: tokensRemaining(u) };
  }
  const { seasonRp, rank } = grantTaskRp(u, name, amount);
  return { ok: true, rewardType: 'rp', reward: amount, seasonRp, rank };
}

/** Submit a manual task for admin approval. */
export function submitTaskManual(u: number, name: string, taskId: string): { ok: boolean; error?: string } {
  ensureSeason();
  userRec(u, name);
  const def = taskDef(taskId);
  if (!def || !def.active || def.verifyMethod !== 'manual') return { ok: false, error: 'invalid_task' };
  const p = getProg(u, taskId, undefined);
  if (p.state === 'claimed') return { ok: false, error: 'already_claimed' };
  if (p.state === 'pending') return { ok: false, error: 'already_submitted' };

  p.state = 'pending';
  save();
  return { ok: true };
}

/** The @channel to verify for Telegram-join tasks (route calls getChatMember). */
export function tgJoinChannel(taskId?: string): string | null {
  if (taskId) {
    const def = taskDef(taskId);
    return def?.active && def.channel ? def.channel : null;
  }
  const def = taskDef('tg_join');
  return def?.active && def.channel ? def.channel : null;
}

// ---- admin task management (§7.8) -------------------------------------------

export function adminTasks(): Array<TaskDef & { completed: number; claimed: number }> {
  ensureSeason();
  return state.taskCatalog
    .slice()
    .sort((a, b) => a.sort - b.sort)
    .map((t) => {
      let completed = 0;
      let claimed = 0;
      for (const [k, p] of Object.entries(state.taskProgress)) {
        if (k.split(':')[1] !== t.id) continue;
        if (p.state === 'claimed') claimed++;
        else if (p.state === 'completed') completed++;
      }
      return { ...t, completed, claimed };
    });
}

export interface TaskEdit {
  title?: string;
  rewardType?: RewardType;
  rewardAmount?: number;
  verifyMethod?: VerifyMethod;
  url?: string;
  channel?: string;
  active?: boolean;
  sort?: number;
}

export function editTask(actor: string, id: string, patch: TaskEdit): boolean {
  const def = taskDef(id);
  if (!def) return false;
  const before = { ...def };
  if (patch.title !== undefined) def.title = String(patch.title).slice(0, 120);
  if (patch.rewardType !== undefined && (patch.rewardType === 'rp' || patch.rewardType === 'token')) {
    def.rewardType = patch.rewardType;
  }
  if (patch.verifyMethod !== undefined && ['server', 'tg_member', 'click_claim', 'referral', 'manual'].includes(patch.verifyMethod)) {
    def.verifyMethod = patch.verifyMethod;
  }
  if (patch.rewardAmount !== undefined) def.rewardAmount = clampReward(def.rewardType, patch.rewardAmount);
  if (patch.url !== undefined) def.url = String(patch.url).slice(0, 300);
  if (patch.channel !== undefined) def.channel = String(patch.channel).slice(0, 100);
  if (patch.active !== undefined) def.active = !!patch.active;
  if (patch.sort !== undefined) def.sort = Math.floor(Number(patch.sort) || def.sort);
  audit(actor, 'task_edit', 'task', id, before, { ...def });
  save();
  return true;
}

export function createTask(actor: string, task: TaskDef): boolean {
  ensureSeason();
  if (!task.id || state.taskCatalog.some((t) => t.id === task.id)) return false;
  task.rewardAmount = clampReward(task.rewardType, task.rewardAmount);
  state.taskCatalog.push(task);
  audit(actor, 'task_create', 'task', task.id, undefined, task);
  save();
  return true;
}

export interface PendingTaskSub {
  u: number;
  name: string;
  taskId: string;
  taskTitle: string;
  rewardType: RewardType;
  rewardAmount: number;
}

export function pendingTaskSubmissions(): PendingTaskSub[] {
  ensureSeason();
  const list: PendingTaskSub[] = [];
  for (const [key, prog] of Object.entries(state.taskProgress)) {
    if (prog.state !== 'pending') continue;
    const parts = key.split(':');
    const u = Number(parts[0]);
    const taskId = parts[1];
    if (!u || !taskId) continue;
    const def = taskDef(taskId);
    if (!def) continue;
    list.push({
      u,
      name: userName(u),
      taskId,
      taskTitle: def.title,
      rewardType: def.rewardType,
      rewardAmount: def.rewardAmount,
    });
  }
  return list;
}

export function approveTaskSubmission(actor: string, u: number, taskId: string): { ok: boolean; error?: string } {
  ensureSeason();
  const def = taskDef(taskId);
  if (!def) return { ok: false, error: 'unknown_task' };
  const p = getProg(u, taskId, undefined);
  if (p.state !== 'pending') return { ok: false, error: 'not_pending' };

  p.state = 'claimed';
  p.claimedAt = Date.now();
  p.progress = Math.max(p.progress, def.target);

  const amount = clampReward(def.rewardType, def.rewardAmount);
  if (def.rewardType === 'token') {
    grantBonusToken(u, amount);
  } else {
    grantTaskRp(u, userName(u), amount);
  }
  audit(actor, 'task_manual_approve', 'task', taskId, undefined, { u, amount, rewardType: def.rewardType });
  save();
  return { ok: true };
}

export function rejectTaskSubmission(actor: string, u: number, taskId: string): { ok: boolean; error?: string } {
  ensureSeason();
  const p = getProg(u, taskId, undefined);
  if (p.state !== 'pending') return { ok: false, error: 'not_pending' };
  p.state = 'in_progress';
  audit(actor, 'task_manual_reject', 'task', taskId, undefined, { u });
  save();
  return { ok: true };
}

export { DAILY_POOL_IDS };

export function prizesView(): { season: string; winners: PrizeRec[] } {
  ensureSeason();
  const prev = previousSeasonId(state.activeSeason);
  return { season: prev, winners: state.prizes[prev] ?? [] };
}

export function activeSeasonId(): string {
  ensureSeason();
  return state.activeSeason;
}

// ============================================================================
// PRD-ADMIN-EMAIL — email capture, admin sessions, audit, flags, prize workflow
// ============================================================================

const MAX_EMAIL_CHANGES = 3;

export const maskEmail = (email: string): string => {
  const at = email.indexOf('@');
  if (at < 1) return '••••';
  const name = email.slice(0, at);
  const head = name.slice(0, 2);
  return `${head}${'•'.repeat(Math.max(2, name.length - 2))}@${email.slice(at + 1)}`;
};

/** A player is frozen from email changes while they hold an unresolved prize
 *  (season closed, not yet applied) — so a winner can't swap accounts (PRD §5.3). */
export function isEmailFrozen(u: number): boolean {
  ensureSeason();
  for (const winners of Object.values(state.prizes)) {
    for (const p of winners) {
      if (p.u === u && (p.state === 'pending' || p.state === 'linked')) return true;
    }
  }
  return false;
}

export type SetEmailResult =
  | { ok: true; masked: string; changesLeft: number }
  | { ok: false; error: 'change_limit' | 'frozen' };

/** Store a player's email (already validated + normalized by the caller). */
export function setEmail(
  u: number,
  name: string,
  email: string,
  normalized: string,
  source: 'game' | 'admin' = 'game',
): SetEmailResult {
  ensureSeason();
  const rec = userRec(u, name);
  if (source === 'game' && isEmailFrozen(u)) return { ok: false, error: 'frozen' };

  // Per-season change counter (resets each season).
  if (rec.emailChangesSeason !== state.activeSeason) {
    rec.emailChangesSeason = state.activeSeason;
    rec.emailChanges = 0;
  }
  const isChange = !!rec.email && rec.emailNormalized !== normalized;
  if (source === 'game' && isChange && (rec.emailChanges ?? 0) >= MAX_EMAIL_CHANGES) {
    return { ok: false, error: 'change_limit' };
  }
  if (isChange) rec.emailChanges = (rec.emailChanges ?? 0) + 1;
  rec.email = email;
  rec.emailNormalized = normalized;
  rec.emailSetAt = Date.now();
  state.emailHistory.push({ id: rid(6), u, email, setAt: Date.now(), source });

  // Duplicate detection: same normalized email on ≥2 uids → flag all involved for
  // review (accepted, not blocked — legit family cases exist; abuse must be visible).
  const dupes = Object.entries(state.users).filter(([, r]) => r.emailNormalized === normalized);
  if (dupes.length >= 2) {
    for (const [uid] of dupes) raiseFlag(Number(uid), 'duplicate_email', `shared: ${maskEmail(email)}`);
  }
  save();
  return {
    ok: true,
    masked: maskEmail(email),
    changesLeft: Math.max(0, MAX_EMAIL_CHANGES - (rec.emailChanges ?? 0)),
  };
}

export interface AccountView {
  masked: string | null;
  changesLeft: number;
  emailSetAt: number | null;
  eligible: boolean;
  frozen: boolean;
}

export function accountOf(u: number): AccountView {
  ensureSeason();
  const rec = state.users[String(u)];
  const s = state.scores[String(u)];
  const changes = rec?.emailChangesSeason === state.activeSeason ? (rec?.emailChanges ?? 0) : 0;
  return {
    masked: rec?.email ? maskEmail(rec.email) : null,
    changesLeft: Math.max(0, MAX_EMAIL_CHANGES - changes),
    emailSetAt: rec?.emailSetAt ?? null,
    eligible: !!rec?.email && (s?.matches ?? 0) >= ELIGIBILITY_FLOOR,
    frozen: isEmailFrozen(u),
  };
}

/** Delete a player's email (self-service privacy — PRD §12 Q4). */
export function deleteEmail(u: number): boolean {
  ensureSeason();
  const rec = state.users[String(u)];
  if (!rec || !rec.email) return false;
  if (isEmailFrozen(u)) return false;
  state.emailHistory.push({ id: rid(6), u, email: '(deleted)', setAt: Date.now(), source: 'game' });
  delete rec.email;
  delete rec.emailNormalized;
  delete rec.emailSetAt;
  save();
  return true;
}

// ---- flags (PRD §6.3) -------------------------------------------------------

/** Raise an advisory flag (idempotent per open kind+user+season). */
export function raiseFlag(u: number, kind: string, evidence: string): void {
  const season = state.activeSeason;
  const exists = state.flags.some(
    (f) => f.u === u && f.kind === kind && f.seasonId === season && f.state === 'open',
  );
  if (exists) return;
  state.flags.push({
    id: rid(6),
    u,
    seasonId: season,
    kind,
    evidence,
    state: 'open',
    createdAt: Date.now(),
  });
}

/** Re-evaluate heuristic anomaly flags across the active season (PRD §6.3). */
export function evaluateFlags(): number {
  ensureSeason();
  const scores = Object.values(state.scores);
  // accuracy_outlier: > 3σ above the mean at ≥30 matches.
  const eligible = scores.filter((s) => s.matches >= 30 && s.rounds > 0);
  if (eligible.length >= 3) {
    const accs = eligible.map((s) => s.correct / s.rounds);
    const mean = accs.reduce((a, b) => a + b, 0) / accs.length;
    const sd = Math.sqrt(accs.reduce((a, b) => a + (b - mean) ** 2, 0) / accs.length) || 0;
    if (sd > 0) {
      for (const s of eligible) {
        const acc = s.correct / s.rounds;
        if (acc > mean + 3 * sd)
          raiseFlag(s.u, 'accuracy_outlier', `acc ${(acc * 100).toFixed(0)}% vs mean ${(mean * 100).toFixed(0)}%`);
      }
    }
  }
  // speed_outlier + burst_play from the match log (this season).
  const byUser = new Map<number, MatchLogRec[]>();
  for (const m of state.matchLog) {
    if (m.season !== state.activeSeason) continue;
    const arr = byUser.get(m.u) ?? [];
    arr.push(m);
    byUser.set(m.u, arr);
  }
  for (const [u, logs] of byUser) {
    const timed = logs.filter((l) => l.avgMs > 0).map((l) => l.avgMs);
    if (timed.length >= 10) {
      const sorted = [...timed].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)]!;
      if (median < 1500) raiseFlag(u, 'speed_outlier', `median ${median}ms`);
    }
    // burst_play: > 10 ranked matches within any 20-minute window.
    const ts = logs.map((l) => l.ts).sort((a, b) => a - b);
    for (let i = 0; i + 10 < ts.length; i++) {
      if (ts[i + 10]! - ts[i]! <= 20 * 60_000) {
        raiseFlag(u, 'burst_play', `11 matches in ${Math.round((ts[i + 10]! - ts[i]!) / 60000)}m`);
        break;
      }
    }
  }
  save();
  return state.flags.filter((f) => f.state === 'open').length;
}

export function openFlags(): FlagRec[] {
  ensureSeason();
  return state.flags.filter((f) => f.state === 'open').sort((a, b) => b.createdAt - a.createdAt);
}

export function resolveFlag(id: string, actor: string, action: 'clear' | 'exclude' | 'ban', note: string): boolean {
  const f = state.flags.find((x) => x.id === id);
  if (!f || f.state !== 'open') return false;
  f.state = action === 'clear' ? 'cleared' : 'actioned';
  f.resolvedBy = actor;
  f.resolvedAt = Date.now();
  if (action === 'ban') banUser(f.u, actor, `via flag ${f.kind}: ${note}`);
  if (action === 'exclude') excludeFromPrizes(f.u);
  audit(actor, `flag_${action}`, 'flag', id, undefined, { note });
  save();
  return true;
}

/** Excluded winners are rolled down by the prize workflow with a visible reason. */
const excluded = new Set<number>();
function excludeFromPrizes(u: number): void {
  excluded.add(u);
}
export function isExcluded(u: number): boolean {
  return excluded.has(u) || (state.users[String(u)]?.banned ?? false);
}

export function banUser(u: number, actor: string, reason: string): void {
  const rec = state.users[String(u)];
  if (rec) rec.banned = true;
  audit(actor, 'ban', 'user', String(u), undefined, { reason });
  save();
}

export function setNote(u: number, actor: string, note: string): void {
  const rec = userRec(u);
  const before = rec.adminNote;
  rec.adminNote = note;
  audit(actor, 'set_note', 'user', String(u), { note: before }, { note });
  save();
}

// ---- audit log (PRD §6.1) ---------------------------------------------------

export function audit(
  actor: string,
  action: string,
  targetType: string,
  targetId: string,
  before?: unknown,
  after?: unknown,
  note?: string,
): void {
  state.auditLog.push({
    id: rid(6),
    actor,
    action,
    targetType,
    targetId,
    before,
    after,
    note,
    ts: Date.now(),
  });
  if (state.auditLog.length > AUDIT_CAP) state.auditLog.splice(0, state.auditLog.length - AUDIT_CAP);
  save();
}

export function auditEntries(filter: { from?: number; to?: number; actor?: string } = {}): AuditRec[] {
  return state.auditLog
    .filter(
      (e) =>
        (filter.from === undefined || e.ts >= filter.from) &&
        (filter.to === undefined || e.ts <= filter.to) &&
        (!filter.actor || e.actor === filter.actor),
    )
    .sort((a, b) => b.ts - a.ts);
}

// ---- admin sessions (PRD §6.1) ---------------------------------------------

export function createAdminSession(admin: string, ip: string, ttlMs: number): string {
  const token = randomBytes(24).toString('base64url');
  state.adminSessions[token] = { admin, createdAt: Date.now(), expiresAt: Date.now() + ttlMs, ip };
  // Prune expired sessions opportunistically.
  const now = Date.now();
  for (const [t, s] of Object.entries(state.adminSessions)) if (s.expiresAt < now) delete state.adminSessions[t];
  save();
  return token;
}

export function adminSession(token: string | undefined): { admin: string } | null {
  if (!token) return null;
  const s = state.adminSessions[token];
  if (!s || s.expiresAt < Date.now()) return null;
  return { admin: s.admin };
}

export function destroyAdminSession(token: string | undefined): void {
  if (token && state.adminSessions[token]) {
    delete state.adminSessions[token];
    save();
  }
}

// ---- admin reads (PRD §6.2) -------------------------------------------------

export interface AdminPlayerRow {
  u: number;
  name: string;
  email: string | null;
  emailStatus: 'none' | 'provided' | 'duplicate' | 'frozen';
  rp: number;
  rank: number;
  matches: number;
  wins: number;
  accuracy: number;
  streakDays: number;
  tokensSpent: number;
  firstSeen: number | null;
  lastSeen: number;
  flags: string[];
  banned: boolean;
}

function playerRow(u: number): AdminPlayerRow {
  const rec = state.users[String(u)]!;
  const s = state.scores[String(u)];
  const normalized = rec.emailNormalized;
  const dup =
    !!normalized &&
    Object.values(state.users).filter((r) => r.emailNormalized === normalized).length >= 2;
  const emailStatus: AdminPlayerRow['emailStatus'] = !rec.email
    ? 'none'
    : isEmailFrozen(u)
      ? 'frozen'
      : dup
        ? 'duplicate'
        : 'provided';
  const td = state.tokens[`${dayKey()}:${u}`];
  return {
    u,
    name: rec.name,
    email: rec.email ?? null,
    emailStatus,
    rp: s?.rp ?? 0,
    rank: s ? rankOf(u) : 0,
    matches: s?.matches ?? 0,
    wins: s?.wins ?? 0,
    accuracy: s && s.rounds > 0 ? Math.round((s.correct / s.rounds) * 100) : 0,
    streakDays: rec.streakDays,
    tokensSpent: td?.spent ?? 0,
    firstSeen: null,
    lastSeen: s?.lastRpAt ?? rec.emailSetAt ?? 0,
    flags: state.flags.filter((f) => f.u === u && f.state === 'open').map((f) => f.kind),
    banned: rec.banned ?? false,
  };
}

export interface PlayerQuery {
  q?: string;
  filter?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function adminPlayers(query: PlayerQuery): { rows: AdminPlayerRow[]; total: number; page: number; pages: number } {
  ensureSeason();
  let rows = Object.keys(state.users).map((u) => playerRow(Number(u)));

  const q = query.q?.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        String(r.u).includes(q) ||
        (r.email?.toLowerCase().includes(q) ?? false),
    );
  }
  switch (query.filter) {
    case 'has_email': rows = rows.filter((r) => r.emailStatus !== 'none'); break;
    case 'no_email': rows = rows.filter((r) => r.emailStatus === 'none'); break;
    case 'duplicate': rows = rows.filter((r) => r.emailStatus === 'duplicate'); break;
    case 'flagged': rows = rows.filter((r) => r.flags.length > 0); break;
    case 'eligible': rows = rows.filter((r) => r.matches >= ELIGIBILITY_FLOOR); break;
    case 'top50': rows = rows.filter((r) => r.rank > 0 && r.rank <= 50); break;
    default: break;
  }
  // sort: "field" (default, numeric high→low / name A→Z) or "-field" to reverse.
  const sort = query.sort ?? 'rp';
  const asc = sort.startsWith('-');
  const key = sort.replace(/^-/, '') as keyof AdminPlayerRow;
  rows.sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    const cmp =
      typeof av === 'number' && typeof bv === 'number'
        ? bv - av // numbers default high→low
        : String(av ?? '').localeCompare(String(bv ?? '')); // strings default A→Z
    return asc ? -cmp : cmp;
  });

  const total = rows.length;
  const pageSize = Math.min(200, Math.max(10, query.pageSize ?? 50));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, query.page ?? 1));
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total, page, pages };
}

export interface PlayerDetail extends AdminPlayerRow {
  emailHistory: EmailHistoryRec[];
  matchHistory: MatchLogRec[];
  note: string | null;
  rgAccountRef: string | null;
  allFlags: FlagRec[];
}

export function adminPlayer(u: number): PlayerDetail | null {
  ensureSeason();
  if (!state.users[String(u)]) return null;
  const base = playerRow(u);
  return {
    ...base,
    emailHistory: state.emailHistory.filter((e) => e.u === u).sort((a, b) => b.setAt - a.setAt),
    matchHistory: state.matchLog.filter((m) => m.u === u).sort((a, b) => b.ts - a.ts).slice(0, 200),
    note: state.users[String(u)]!.adminNote ?? null,
    rgAccountRef: state.users[String(u)]!.rgAccountRef ?? null,
    allFlags: state.flags.filter((f) => f.u === u).sort((a, b) => b.createdAt - a.createdAt),
  };
}

export interface OverviewView {
  season: { id: string; endsAt: number };
  activePlayers: number;
  newToday: number;
  tokensGranted: number;
  tokensSpent: number;
  matchesToday: number;
  rankedToday: number;
  practiceToday: number;
  aiFillToday: number;
  emailCaptureRate: number;
  openFlags: number;
}

export function adminOverview(): OverviewView {
  ensureSeason();
  const today = dayKey();
  const players = Object.values(state.users);
  const scores = Object.values(state.scores);
  const withEmail = players.filter((r) => !!r.email).length;
  const todayMatches = state.matchLog.filter((m) => dayKey(m.ts) === today);
  let spent = 0;
  for (const [key, t] of Object.entries(state.tokens)) if (key.startsWith(`${today}:`)) spent += t.spent;
  const activePlayers = scores.length;
  return {
    season: { id: state.activeSeason, endsAt: seasonEndsAt(state.activeSeason) },
    activePlayers,
    newToday: players.filter((r) => r.lastPlayedDay === today && (r.streakDays === 1)).length,
    tokensGranted: activePlayers * DAILY_TOKENS,
    tokensSpent: spent,
    matchesToday: todayMatches.length,
    rankedToday: todayMatches.filter((m) => m.mode !== 'free').length,
    practiceToday: todayMatches.filter((m) => m.mode === 'free').length,
    aiFillToday: todayMatches.filter((m) => m.oppKind === 'ai').length,
    emailCaptureRate: activePlayers > 0 ? Math.round((withEmail / activePlayers) * 100) : 0,
    openFlags: state.flags.filter((f) => f.state === 'open').length,
  };
}

export interface StandingRow {
  rank: number;
  u: number;
  name: string;
  rp: number;
  matches: number;
  wins: number;
  accuracy: number;
  hasEmail: boolean;
  eligible: boolean;
  flags: string[];
}

export function adminStandings(seasonId?: string): { season: string; status: 'active' | 'closed'; rows: StandingRow[] } {
  ensureSeason();
  const sid = seasonId ?? state.activeSeason;
  const isActive = sid === state.activeSeason;
  const archived = state.finalStandings[sid] ?? state.hallOfFame[sid] ?? [];
  const source = isActive
    ? Object.values(state.scores).sort(standingsSort)
    : archived.map((h) => ({ u: h.u, name: h.name, rp: h.rp, matches: h.matches ?? 0, wins: 0, correct: 0, rounds: 0, lastRpAt: 0 } as ScoreRec));
  return {
    season: sid,
    status: isActive ? 'active' : 'closed',
    rows: source.map((s, i) => {
      const rec = state.users[String(s.u)];
      return {
        rank: i + 1,
        u: s.u,
        name: s.name,
        rp: s.rp,
        matches: s.matches,
        wins: s.wins,
        accuracy: s.rounds > 0 ? Math.round((s.correct / s.rounds) * 100) : 0,
        hasEmail: !!rec?.email,
        eligible: s.matches >= ELIGIBILITY_FLOOR && !!rec?.email && !isExcluded(s.u),
        flags: state.flags.filter((f) => f.u === s.u && f.state === 'open').map((f) => f.kind),
      };
    }),
  };
}

// ---- prize workflow (PRD §6.4 / Part C) -------------------------------------

export interface PrizeWorkflowRow extends PrizeRec {
  email: string | null;
  matches: number;
  accuracy: number;
  eligible: boolean;
  flags: string[];
  claimDeadline: number;
}

const CLAIM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function prizeWorkflow(seasonId: string): PrizeWorkflowRow[] {
  ensureSeason();
  const prizes = state.prizes[seasonId] ?? [];
  const closedAt = seasonEndsAt(seasonId);
  return prizes.map((p) => {
    const rec = state.users[String(p.u)];
    const s = state.scores[String(p.u)];
    return {
      ...p,
      email: rec?.email ?? null,
      matches: s?.matches ?? 0,
      accuracy: s && s.rounds > 0 ? Math.round((s.correct / s.rounds) * 100) : 0,
      eligible: !!rec?.email && !isExcluded(p.u),
      flags: state.flags.filter((f) => f.u === p.u && f.state === 'open').map((f) => f.kind),
      claimDeadline: closedAt + CLAIM_WINDOW_MS,
    };
  });
}

export interface ApplyPrizeInput {
  share: number;
  effectiveFrom: number;
  effectiveUntil: number;
  backofficeRef?: string;
  note?: string;
}

export function applyPrize(seasonId: string, rank: number, actor: string, input: ApplyPrizeInput): boolean {
  const prize = (state.prizes[seasonId] ?? []).find((p) => p.rank === rank);
  if (!prize || prize.state === 'applied') return false;
  const before = { ...prize };
  prize.state = 'applied';
  prize.appliedBy = actor;
  prize.appliedAt = Date.now();
  prize.shareApplied = input.share;
  prize.effectiveFrom = input.effectiveFrom;
  prize.effectiveUntil = input.effectiveUntil;
  prize.backofficeRef = input.backofficeRef;
  audit(actor, 'prize_apply', 'prize', `${seasonId}#${rank}`, before, { ...prize }, input.note);
  save();
  return true;
}

/** Roll a prize down to the next non-winner in the standings (PRD §6.4). */
export function rollDownPrize(seasonId: string, rank: number, actor: string, reason: string): boolean {
  const prizes = state.prizes[seasonId] ?? [];
  const prize = prizes.find((p) => p.rank === rank);
  if (!prize) return false;
  const before = { ...prize };
  // Find the next standing not already holding a prize, preferring the deeper
  // closed-season snapshot (rank 4+). For a still-active season, use live scores.
  const taken = new Set(prizes.map((p) => p.u));
  const standings =
    state.finalStandings[seasonId] ??
    (state.hallOfFame[seasonId]?.length
      ? state.hallOfFame[seasonId]!
      : Object.values(state.scores).sort(standingsSort).map((s, i) => ({ rank: i + 1, u: s.u, name: s.name, rp: s.rp })));
  // The next eligible standing: an email on file (the whole point), the 20-match
  // floor met, and not excluded. For a closed season the floor is read from the
  // snapshot (live scores have reset); for an active one, from live scores.
  const closed = state.finalStandings[seasonId] !== undefined || state.hallOfFame[seasonId] !== undefined;
  const next = standings.find((h) => {
    if (taken.has(h.u) || isExcluded(h.u)) return false;
    if (!state.users[String(h.u)]?.email) return false;
    const played = closed ? (h.matches ?? 0) : (state.scores[String(h.u)]?.matches ?? 0);
    return played >= ELIGIBILITY_FLOOR;
  });
  prize.rolledDownReason = reason;
  prize.state = 'expired';
  if (next) {
    prizes.push({ rank, u: next.u, name: next.name, sharePct: prize.sharePct, state: 'pending' });
  }
  audit(actor, 'prize_rolldown', 'prize', `${seasonId}#${rank}`, before, { next: next?.u ?? null, reason });
  save();
  return true;
}

/** Manual season-close trigger (idempotent) for the admin panel (PRD §8.4). */
export function forceCloseSeason(): string {
  ensureSeason();
  return state.activeSeason;
}

export function csvWinners(seasonId: string): string {
  const rows = prizeWorkflow(seasonId);
  const head = ['rank', 'name', 'telegram_id', 'email', 'rp', 'share_pct', 'state', 'effective_from', 'effective_until'];
  const esc = (v: unknown): string => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const hof = state.hallOfFame[seasonId] ?? [];
  const rpOf = (u: number): number =>
    hof.find((h) => h.u === u)?.rp ?? state.scores[String(u)]?.rp ?? 0;
  const body = rows.map((r) =>
    [
      r.rank,
      r.name,
      r.u,
      r.email ?? '',
      rpOf(r.u),
      r.sharePct,
      r.state,
      r.effectiveFrom ? new Date(r.effectiveFrom).toISOString().slice(0, 10) : '',
      r.effectiveUntil ? new Date(r.effectiveUntil).toISOString().slice(0, 10) : '',
    ]
      .map(esc)
      .join(','),
  );
  // UTF-8 BOM so Excel renders Persian names correctly (PRD Story 5).
  return '﻿' + [head.join(','), ...body].join('\r\n');
}

/** Winners of a season who still lack an email (for reminder DMs — PRD §6.3). */
export function winnersMissingEmail(seasonId: string): number[] {
  return (state.prizes[seasonId] ?? [])
    .filter((p) => p.state === 'pending' && !state.users[String(p.u)]?.email)
    .map((p) => p.u);
}

export function setRgAccountRef(u: number, actor: string, ref: string): void {
  const rec = userRec(u);
  const before = rec.rgAccountRef;
  rec.rgAccountRef = ref;
  audit(actor, 'set_account_ref', 'user', String(u), { ref: before }, { ref });
  save();
}
