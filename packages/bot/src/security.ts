import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config';

/**
 * The signed launch context (SPEC §5.3). When the player taps Play, the bot mints a
 * short token tying that launch to a real Telegram user + message; the frontend
 * echoes it back on /score, and only a token the bot itself signed is accepted.
 * The BOT_TOKEN that can write scores lives only here, never in the browser.
 */
export interface GameContext {
  u: number; // user id
  n?: string; // display name (from Telegram at launch) — for the leaderboard
  c?: number; // chat id
  m?: number; // message id
  i?: string; // inline_message_id
  t: number; // issued-at (ms) — used for expiry / replay window
}

const b64urlEncode = (s: string): string => Buffer.from(s).toString('base64url');
const b64urlDecode = (s: string): string => Buffer.from(s, 'base64url').toString('utf8');

export function signContext(payload: GameContext): string {
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = createHmac('sha256', config.scoreSecret).update(body).digest('hex');
  return `${body}.${sig}`;
}

export function verifyContext(token: string, maxAgeMs = 24 * 60 * 60 * 1000): GameContext | null {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', config.scoreSecret).update(body).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: GameContext;
  try {
    payload = JSON.parse(b64urlDecode(body)) as GameContext;
  } catch {
    return null;
  }
  if (typeof payload.u !== 'number' || typeof payload.t !== 'number') return null;
  if (Date.now() - payload.t > maxAgeMs) return null;
  return payload;
}

// Per-user rate limit (cheap in-memory; swap for Redis at scale).
const lastSubmit = new Map<number, number>();
export function rateLimit(userId: number, minIntervalMs = 1500): boolean {
  const now = Date.now();
  const prev = lastSubmit.get(userId) ?? 0;
  if (now - prev < minIntervalMs) return false;
  lastSubmit.set(userId, now);
  return true;
}

/** Client scores are untrusted: coerce to a sane integer in bounds (SPEC §5.3). */
export const MAX_SCORE = 1_000_000;
export function clampScore(score: unknown): number {
  const n = typeof score === 'number' && Number.isFinite(score) ? Math.floor(score) : 0;
  return Math.max(0, Math.min(MAX_SCORE, n));
}
