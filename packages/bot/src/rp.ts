/**
 * Rush Points (RP) scoring engine — PRD-SCORING-TOKENS §5.B / Appendix A.
 *
 * Pure functions only (no I/O) so the math is unit-testable and the server can
 * recompute RP from submitted rounds — it NEVER trusts a client-computed total.
 *
 *   match RP = ( Σ correct × [10|20|30]                base (Retail|Pro|Whale)
 *              + flawless [20|40|60]                   if 5/5
 *              + win bonus [30 human | 15 AI]          ranked duels only
 *              + win-streak 5×(streak−1) (cap 25) )    consecutive duel wins
 *              × daily-streak multiplier               1 + 0.05×min(days−1,5)
 *
 * Sudden-death rounds (n > 5) score 0 RP (tie-breaker only — prevents
 * tie-farming). Duel WINNERS are still decided by correct count → total time;
 * RP bonuses are leaderboard-only and never affect who wins a match.
 */

export type LevelId = 'retail' | 'pro' | 'whale';
export type OppKind = 'human' | 'ai' | 'none';
export type RankedMode = 'quick' | 'live' | 'duel';

export const LEVEL_WEIGHT: Record<LevelId, number> = { retail: 1, pro: 2, whale: 3 };
export const LEVEL_IDS: readonly LevelId[] = ['retail', 'pro', 'whale'];

/** Base RP per correct call = weight × 10 (PRD §5.B — ×10 keeps the 1/2/3 ratio). */
export const RP_PER_CORRECT = 10;
/** Rounds that score RP; sudden-death rounds beyond this pay 0. */
export const BASE_ROUNDS = 5;
/** Flawless (5/5) bonus = weight × 20 → 20/40/60. */
export const FLAWLESS_PER_WEIGHT = 20;
export const WIN_BONUS_HUMAN = 30;
export const WIN_BONUS_AI = 15;
/** Win-streak: +5 RP per consecutive duel win beyond the first, capped at +25.
 *  (The PRD's worked example — 1st win, no streak bonus — fixes the interpretation.) */
export const WIN_STREAK_STEP = 5;
export const WIN_STREAK_CAP = 25;
/** Daily streak multiplier: day 1 ×1.00 … day 6+ ×1.25 (PRD §5.B). */
export const DAY_STREAK_STEP = 0.05;
export const DAY_STREAK_MAX = 5;
/** Hard per-match cap — clamps any tampered submission (PRD §8.3):
 *  (150 + 60 + 30 + 25) × 1.25 = 331.25 → 332. */
export const RP_MATCH_CAP = 332;

/** Daily Rush Tokens (PRD §5.A). */
export const DAILY_TOKENS = 10;

export interface RpBreakdown {
  base: number;
  flawless: number;
  win: number;
  winStreak: number;
  /** The daily-streak multiplier applied to the subtotal. */
  multiplier: number;
  total: number;
}

export function dayStreakMultiplier(streakDays: number): number {
  const days = Math.max(1, Math.floor(streakDays));
  return 1 + DAY_STREAK_STEP * Math.min(days - 1, DAY_STREAK_MAX);
}

/**
 * Compute a ranked match's RP.
 * @param correctBase  correct calls among the first BASE_ROUNDS only
 * @param won          whether this player won the duel (false for solo Quick Play)
 * @param oppKind      'human' | 'ai' for duels, 'none' for solo
 * @param winStreak    consecutive ranked duel wins INCLUDING this one (0 if lost/solo)
 * @param streakDays   consecutive-day play streak (≥1 once they played today)
 */
export function computeRp(
  level: LevelId,
  correctBase: number,
  won: boolean,
  oppKind: OppKind,
  winStreak: number,
  streakDays: number,
): RpBreakdown {
  const w = LEVEL_WEIGHT[level];
  const correct = Math.max(0, Math.min(BASE_ROUNDS, Math.floor(correctBase)));
  const base = correct * w * RP_PER_CORRECT;
  const flawless = correct === BASE_ROUNDS ? w * FLAWLESS_PER_WEIGHT : 0;
  const isDuel = oppKind === 'human' || oppKind === 'ai';
  const win = won && isDuel ? (oppKind === 'human' ? WIN_BONUS_HUMAN : WIN_BONUS_AI) : 0;
  const streakWins = won && isDuel ? Math.max(0, Math.floor(winStreak) - 1) : 0;
  const winStreakBonus = Math.min(WIN_STREAK_CAP, streakWins * WIN_STREAK_STEP);
  const multiplier = dayStreakMultiplier(streakDays);
  const total = Math.min(RP_MATCH_CAP, Math.round((base + flawless + win + winStreakBonus) * multiplier));
  return { base, flawless, win, winStreak: winStreakBonus, multiplier, total };
}

// ---- UTC calendar helpers (PRD: all boundaries in UTC) ----------------------

/** UTC day key, e.g. "2026-07-20". */
export const dayKey = (t = Date.now()): string => new Date(t).toISOString().slice(0, 10);

/** UTC season id, e.g. "2026-07" (a season = one calendar month — PRD §5.C). */
export const seasonOf = (t = Date.now()): string => new Date(t).toISOString().slice(0, 7);

/** Millisecond timestamp of the given season's end (= start of the next month, UTC). */
export function seasonEndsAt(seasonId: string): number {
  const y = Number(seasonId.slice(0, 4));
  const m = Number(seasonId.slice(5, 7)); // 1-based
  return Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1);
}

/** Next daily token refill (00:00 UTC — PRD §5.A). */
export function nextRefillAt(t = Date.now()): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}
