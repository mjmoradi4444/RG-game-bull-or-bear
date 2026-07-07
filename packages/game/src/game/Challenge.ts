/**
 * Async-duel deep-link codec (SPEC §4.1/§4.2).
 *
 * A challenge link carries a match **seed** (which 4 puzzles — deterministic for
 * both players because PuzzleBank.pick runs over a seeded Rng), plus the
 * challenger's score + name, so the recipient plays the SAME set and the app can
 * declare a winner. v1 carries the challenger's count in the link; the bot's
 * server-side scoring (validating the actual calls) lands in Phase 6.
 */
import type { LevelId } from './levels';

export interface Challenge {
  seed: number;
  score: number; // challenger's correct count
  name: string; // challenger display name
  level: LevelId; // the level both players share (same difficulty → same puzzles)
  /** Challenger's total decision time (ms) — breaks a tied score (faster wins). */
  timeMs?: number;
}

const PREFIX = 'duel_';
const MAX_NAME = 18;
const LEVELS: readonly LevelId[] = ['retail', 'pro', 'whale'];

export function makeSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
}

// UTF-8-safe base64url (names may be non-latin, e.g. Persian).
function b64urlEncode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
function b64urlDecode(s: string): string {
  return decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
}

/** Encode a challenge as `duel_<token>` for the deep link.
 *  Layout: seed|score|level|time|name (name last so a '|' in it stays unambiguous). */
export function encodeChallenge(c: Challenge): string {
  const name = c.name.slice(0, MAX_NAME);
  const score = Math.max(0, Math.min(99, Math.round(c.score)));
  const time = Math.max(0, Math.min(9_999_999, Math.round(c.timeMs ?? 0)));
  return PREFIX + b64urlEncode(`${c.seed >>> 0}|${score}|${c.level}|${time}|${name}`);
}

/** Decode a start param into a Challenge, or null if it isn't a valid duel link.
 *  Tolerates the older seed|score|level|name layout (no time field). */
export function decodeChallenge(startParam: string | null): Challenge | null {
  if (!startParam || !startParam.startsWith(PREFIX)) return null;
  try {
    const raw = b64urlDecode(startParam.slice(PREFIX.length));
    const parts = raw.split('|');
    const [seedS, scoreS, levelS] = parts;
    const seed = Number(seedS) >>> 0;
    if (!Number.isFinite(seed) || seed === 0) return null;
    const level = (LEVELS as readonly string[]).includes(levelS ?? '')
      ? (levelS as LevelId)
      : 'pro';
    const hasTime = parts.length >= 5 && /^\d+$/.test(parts[3] ?? '');
    const nameParts = parts.slice(hasTime ? 4 : 3);
    return {
      seed,
      score: Math.max(0, Math.min(99, Number(scoreS) || 0)),
      name: (nameParts.join('|') || 'A friend').slice(0, MAX_NAME),
      level,
      timeMs: hasTime ? Number(parts[3]) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Shareable challenge URL for the current origin. Phase 6 swaps this for the real
 * `t.me/<bot>?startapp=…` deep link via the platform adapter.
 */
export function challengeUrl(c: Challenge): string {
  return `${window.location.origin}/?startapp=${encodeChallenge(c)}`;
}
