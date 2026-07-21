import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config';
import type { LevelId, RankedMode } from './rp';

/**
 * Single-use match tokens (PRD §5.A / §8.3): `POST /match/start` atomically spends
 * a Rush Token and returns one of these; `/match/result` only accepts a result
 * bound to a valid, unconsumed token — the client can't mint ranked plays.
 *
 * HMAC-signed with the same SCORE_SECRET as the launch context but domain-
 * separated (the `mt:` prefix), so a gctx can never be replayed as a matchToken
 * or vice-versa. Single-use enforcement lives in the store (consumed set).
 */
export interface MatchTokenPayload {
  u: number;
  /** Unique match id — the single-use key. */
  m: string;
  /** Season the token was issued in (a rollover match scores into it — PRD §6). */
  s: string;
  l: LevelId;
  k: RankedMode;
  /** Issued-at (ms). */
  t: number;
}

/** Generous window: a match takes minutes, but ads/long sessions shouldn't 401. */
const MATCH_TOKEN_TTL_MS = 3 * 60 * 60 * 1000;

const b64e = (s: string): string => Buffer.from(s).toString('base64url');
const b64d = (s: string): string => Buffer.from(s, 'base64url').toString('utf8');
const mac = (body: string): string =>
  createHmac('sha256', config.scoreSecret).update(`mt:${body}`).digest('hex');

export const newMatchId = (): string => randomBytes(8).toString('hex');

export function signMatchToken(payload: MatchTokenPayload): string {
  const body = b64e(JSON.stringify(payload));
  return `${body}.${mac(body)}`;
}

export function verifyMatchToken(token: string): MatchTokenPayload | null {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(mac(body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: MatchTokenPayload;
  try {
    payload = JSON.parse(b64d(body)) as MatchTokenPayload;
  } catch {
    return null;
  }
  if (typeof payload.u !== 'number' || typeof payload.m !== 'string' || typeof payload.t !== 'number')
    return null;
  if (Date.now() - payload.t > MATCH_TOKEN_TTL_MS) return null;
  return payload;
}
