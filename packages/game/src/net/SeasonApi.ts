import type { LevelId } from '../game/levels';
import { apiBase, launchGctx } from './Multiplayer';

/**
 * Client for the seasonal scoring + Rush Token API (PRD-SCORING-TOKENS §8.2).
 * Same transport pattern as Multiplayer.ts: small same-origin JSON requests, no
 * Telegram imports. All calls silently no-op (resolve null) when the game wasn't
 * launched from the bot (no signed gctx) — plain-browser dev stays free play.
 */

export interface SeasonProfile {
  tokens: number;
  refillAt: number;
  streakDays: number;
  multiplier: number;
  season: { id: string; endsAt: number };
  rp: number;
  rank: number;
}

export interface RpBreakdown {
  base: number;
  flawless: number;
  win: number;
  winStreak: number;
  multiplier: number;
  total: number;
}

export interface RpOutcome {
  rp: number;
  breakdown: RpBreakdown;
  seasonRp: number;
  rank: number;
  rankDelta: number;
  tokens: number;
}

export type MatchStart =
  | { ok: true; matchToken: string; tokens: number }
  | { ok: false; noTokens: true; refillAt: number };

export interface BoardRow {
  rank: number;
  u: number;
  name: string;
  rp: number;
  isSelf: boolean;
}

export interface SeasonBoard {
  season: { id: string; endsAt: number };
  hallOfFame: Array<{ rank: number; u: number; name: string; rp: number }>;
  rows: BoardRow[];
  self: { rank: number; rp: number } | null;
}

export interface RoundOut {
  n: number;
  call: 'up' | 'down' | null;
  correct: boolean;
  ms: number;
}

export type RankedMode = 'quick' | 'live' | 'duel';
export type OppKind = 'human' | 'ai' | 'none';

const gctx = (): string | null => launchGctx();

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await r.json()) as T;
}

/** null → not launched from the bot (or the server predates the season API). */
export async function fetchProfile(): Promise<SeasonProfile | null> {
  const g = gctx();
  if (!g) return null;
  try {
    const r = await fetch(`${apiBase()}/profile?gctx=${encodeURIComponent(g)}`);
    const d = (await r.json()) as { ok: boolean } & SeasonProfile;
    return d.ok ? d : null;
  } catch {
    return null;
  }
}

/** Spend a Rush Token and get the single-use matchToken. Throws on transport error. */
export async function matchStart(mode: RankedMode, level: LevelId): Promise<MatchStart> {
  const g = gctx();
  if (!g) throw new Error('no gctx');
  const d = await post<{
    ok: boolean;
    matchToken?: string;
    tokens?: number;
    error?: string;
    refillAt?: number;
  }>('/match/start', { gctx: g, mode, level });
  if (d.ok && d.matchToken) return { ok: true, matchToken: d.matchToken, tokens: d.tokens ?? 0 };
  if (d.error === 'no_tokens') return { ok: false, noTokens: true, refillAt: d.refillAt ?? 0 };
  throw new Error(d.error ?? 'start failed');
}

/** Submit the match result; the server recomputes RP from the rounds. `forexCorrect`
 *  is a client hint used only for the cosmetic forex daily task (never for RP). */
export async function matchResult(
  matchToken: string,
  rounds: RoundOut[],
  won: boolean,
  oppKind: OppKind,
  forexCorrect = 0,
): Promise<RpOutcome> {
  const g = gctx();
  if (!g) throw new Error('no gctx');
  const d = await post<{ ok: boolean; error?: string } & RpOutcome>('/match/result', {
    gctx: g,
    matchToken,
    rounds,
    won,
    oppKind,
    forexCorrect,
  });
  if (!d.ok) throw new Error(d.error ?? 'result rejected');
  return d;
}

/** Refund the token when a match died before round 1 resolved (PRD §5.A). */
export async function matchAbort(matchToken: string): Promise<number | null> {
  const g = gctx();
  if (!g) return null;
  try {
    const d = await post<{ ok: boolean; tokens?: number }>('/match/abort', { gctx: g, matchToken });
    return d.ok ? (d.tokens ?? null) : null;
  } catch {
    return null;
  }
}

/** Seasonal leaderboard + Hall of Fame. Throws on failure so the UI shows an error. */
export async function fetchBoard(): Promise<SeasonBoard> {
  const g = gctx();
  if (!g) throw new Error('no gctx');
  const r = await fetch(`${apiBase()}/leaderboard?gctx=${encodeURIComponent(g)}`);
  const d = (await r.json()) as { ok: boolean } & SeasonBoard;
  if (!d.ok) throw new Error('leaderboard unavailable');
  return d;
}
