import { existsSync, copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE_ROUNDS,
  DAILY_TOKENS,
  computeRp,
  dayKey,
  dayStreakMultiplier,
  seasonEndsAt,
  seasonOf,
  type LevelId,
  type OppKind,
  type RpBreakdown,
} from './rp';

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
}

export interface PrizeRec {
  rank: number;
  u: number;
  name: string;
  sharePct: number;
  state: 'pending' | 'linked' | 'applied' | 'expired';
}

interface TokenDay {
  spent: number;
  refunded: number;
}

interface State {
  activeSeason: string;
  users: Record<string, UserRec>;
  /** Active season's cumulative scores, keyed by user id. */
  scores: Record<string, ScoreRec>;
  /** Previous seasons' top 3, keyed by season id (PRD §5.C Hall of Fame). */
  hallOfFame: Record<string, HofEntry[]>;
  prizes: Record<string, PrizeRec[]>;
  /** Token ledger, keyed `${day}:${u}` — old days pruned lazily. */
  tokens: Record<string, TokenDay>;
  /** Consumed single-use match tokens (matchId → consumed-at), pruned after 24h. */
  consumed: Record<string, number>;
}

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.data');
const FILE = join(DATA_DIR, 'seasons.json');

/** Prize shares by final rank (PRD §5.D — rebate share % for the next month). */
export const PRIZE_SHARES = [100, 90, 80] as const;
/** Prize eligibility floor: ≥ 20 ranked matches in the season (PRD §5.C). */
export const ELIGIBILITY_FLOOR = 20;

const state: State = load();

function load(): State {
  try {
    if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, 'utf8')) as State;
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
    prizes: {},
    tokens: {},
    consumed: {},
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
  const hof: HofEntry[] = standings
    .slice(0, 3)
    .map((s, i) => ({ rank: i + 1, u: s.u, name: s.name, rp: s.rp }));
  // Prizes go to the top 3 AMONG ELIGIBLE players (≥ floor matches — PRD §5.C).
  const prizes: PrizeRec[] = standings
    .filter((s) => s.matches >= ELIGIBILITY_FLOOR)
    .slice(0, PRIZE_SHARES.length)
    .map((s, i) => ({ rank: i + 1, u: s.u, name: s.name, sharePct: PRIZE_SHARES[i]!, state: 'pending' }));

  state.hallOfFame[closing] = hof;
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
  return Math.max(0, Math.min(DAILY_TOKENS, DAILY_TOKENS - t.spent + t.refunded));
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

function previousSeasonId(seasonId: string): string {
  const y = Number(seasonId.slice(0, 4));
  const m = Number(seasonId.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function prizesView(): { season: string; winners: PrizeRec[] } {
  ensureSeason();
  const prev = previousSeasonId(state.activeSeason);
  return { season: prev, winners: state.prizes[prev] ?? [] };
}

export function activeSeasonId(): string {
  ensureSeason();
  return state.activeSeason;
}
