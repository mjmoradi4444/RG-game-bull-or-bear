import type { IncomingMessage, ServerResponse } from 'node:http';
import { rateLimit, verifyContext, type GameContext } from './security';
import { newMatchId, signMatchToken, verifyMatchToken } from './matchToken';
import {
  BASE_ROUNDS,
  LEVEL_IDS,
  nextRefillAt,
  type LevelId,
  type OppKind,
  type RankedMode,
} from './rp';
import {
  applyResult,
  boardOf,
  activeSeasonId,
  consume,
  isConsumed,
  prizesView,
  profileOf,
  refundToken,
  spendToken,
  tokensRemaining,
  touchDailyStreak,
} from './store';
import { bot } from './bot';
import { submitGameScore } from './telegram';

/**
 * Seasonal scoring + token API (PRD-SCORING-TOKENS §8.2). Extends the existing
 * single bot server; /score + /highscores stay for backward compatibility during
 * rollout. All writes require the HMAC-signed gctx PLUS the single-use matchToken.
 *
 *   GET  /profile?gctx=…                 → tokens, streak, season, rp, rank
 *   POST /match/start  {gctx,mode,level} → { matchToken, tokens } | 402 no_tokens
 *   POST /match/result {gctx,matchToken,rounds,won,oppKind}
 *                                        → { rp, breakdown, seasonRp, rank, rankDelta } | 409
 *   POST /match/abort  {gctx,matchToken} → refund (match died before round 1)
 *   GET  /leaderboard?gctx=…             → season, hallOfFame, rows, self
 *   GET  /prizes                         → prize winners' claim state (public copy)
 */
const READ_TTL_MS = 12 * 60 * 60 * 1000;

const MAX_ROUNDS = 8; // 5 base + up to 3 sudden-death

interface RoundIn {
  n: number;
  call: 'up' | 'down' | null;
  correct: boolean;
  ms: number;
}

function json(res: ServerResponse, status: number, body: unknown, allowOrigin: string): void {
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, cap = 8192): Promise<string> {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > cap) throw new Error('body too large');
  }
  return data;
}

function ctxFrom(raw: unknown): GameContext | null {
  return verifyContext(String(raw ?? ''), READ_TTL_MS);
}

/** Sanitize the submitted rounds array; null = malformed submission. */
function parseRounds(raw: unknown): RoundIn[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ROUNDS) return null;
  const out: RoundIn[] = [];
  const seen = new Set<number>();
  for (const r of raw as Array<Record<string, unknown>>) {
    const n = Math.floor(Number(r?.n));
    if (!Number.isFinite(n) || n < 1 || n > MAX_ROUNDS || seen.has(n)) return null;
    seen.add(n);
    const call = r?.call === 'up' || r?.call === 'down' ? r.call : null;
    out.push({
      n,
      call,
      // A null call (timeout) can never be correct — server-side consistency.
      correct: r?.correct === true && call !== null,
      ms: Math.max(0, Math.min(120_000, Number(r?.ms) || 0)),
    });
  }
  return out;
}

export async function handleSeason(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  allowOrigin: string,
): Promise<boolean> {
  // -- GET /profile --------------------------------------------------------
  if (req.method === 'GET' && url.pathname === '/profile') {
    const ctx = ctxFrom(url.searchParams.get('gctx'));
    if (!ctx) {
      json(res, 401, { ok: false, error: 'bad_context' }, allowOrigin);
      return true;
    }
    json(res, 200, { ok: true, ...profileOf(ctx.u, ctx.n) }, allowOrigin);
    return true;
  }

  // -- POST /match/start ---------------------------------------------------
  if (req.method === 'POST' && url.pathname === '/match/start') {
    const data = JSON.parse((await readBody(req)) || '{}') as {
      gctx?: string;
      mode?: string;
      level?: string;
    };
    const ctx = ctxFrom(data.gctx);
    if (!ctx) {
      json(res, 401, { ok: false, error: 'bad_context' }, allowOrigin);
      return true;
    }
    if (!rateLimit(ctx.u, 1000)) {
      json(res, 429, { ok: false, error: 'rate_limited' }, allowOrigin);
      return true;
    }
    const level = (LEVEL_IDS as readonly string[]).includes(data.level ?? '')
      ? (data.level as LevelId)
      : 'retail';
    const mode: RankedMode =
      data.mode === 'live' || data.mode === 'duel' ? data.mode : 'quick';

    // First ranked match of the day extends the daily streak (PRD Story 6).
    touchDailyStreak(ctx.u, ctx.n);
    const tokens = spendToken(ctx.u);
    if (tokens === null) {
      json(res, 402, { ok: false, error: 'no_tokens', refillAt: nextRefillAt() }, allowOrigin);
      return true;
    }
    const matchToken = signMatchToken({
      u: ctx.u,
      m: newMatchId(),
      s: activeSeasonId(),
      l: level,
      k: mode,
      t: Date.now(),
    });
    json(res, 200, { ok: true, matchToken, tokens }, allowOrigin);
    return true;
  }

  // -- POST /match/result --------------------------------------------------
  if (req.method === 'POST' && url.pathname === '/match/result') {
    const data = JSON.parse((await readBody(req)) || '{}') as {
      gctx?: string;
      matchToken?: string;
      rounds?: unknown;
      won?: unknown;
      oppKind?: unknown;
    };
    const ctx = ctxFrom(data.gctx);
    const mt = verifyMatchToken(String(data.matchToken ?? ''));
    if (!ctx || !mt || mt.u !== ctx.u) {
      json(res, 401, { ok: false, error: 'bad_context' }, allowOrigin);
      return true;
    }
    if (isConsumed(mt.m)) {
      json(res, 409, { ok: false, error: 'already_scored' }, allowOrigin);
      return true;
    }
    if (!rateLimit(ctx.u, 1500)) {
      json(res, 429, { ok: false, error: 'rate_limited' }, allowOrigin);
      return true;
    }
    const rounds = parseRounds(data.rounds);
    if (!rounds) {
      json(res, 400, { ok: false, error: 'bad_rounds' }, allowOrigin);
      return true;
    }
    // RP comes from the first BASE_ROUNDS only — sudden death pays 0 (PRD §5.B).
    // Server recomputes from rounds; the client never submits an RP total.
    const baseRounds = rounds.filter((r) => r.n <= BASE_ROUNDS);
    const correctBase = baseRounds.filter((r) => r.correct).length;
    const oppKind: OppKind =
      data.oppKind === 'human' || data.oppKind === 'ai' ? data.oppKind : 'none';
    // Solo Quick Play can't claim a duel win (mode is signed into the token).
    const won = data.won === true && mt.k !== 'quick' && oppKind !== 'none';

    consume(mt.m); // single-use: burn before applying (replays → 409 above)
    const outcome = applyResult({
      u: ctx.u,
      name: ctx.n ?? 'Player',
      level: mt.l,
      correctBase,
      roundsPlayed: baseRounds.length,
      won,
      oppKind: mt.k === 'quick' ? 'none' : oppKind,
    });

    // Telegram's native in-chat board tracks the season RP total, best-effort
    // (PRD §8.2 — setGameScore stays; ignore stale-message errors).
    if (bot) {
      void submitGameScore(bot.api, ctx, outcome.seasonRp).catch((e) =>
        console.warn('[season] setGameScore skipped:', e instanceof Error ? e.message : e),
      );
    }
    json(res, 200, { ok: true, ...outcome, tokens: tokensRemaining(ctx.u) }, allowOrigin);
    return true;
  }

  // -- POST /match/abort ---------------------------------------------------
  if (req.method === 'POST' && url.pathname === '/match/abort') {
    const data = JSON.parse((await readBody(req)) || '{}') as { gctx?: string; matchToken?: string };
    const ctx = ctxFrom(data.gctx);
    const mt = verifyMatchToken(String(data.matchToken ?? ''));
    if (!ctx || !mt || mt.u !== ctx.u) {
      json(res, 401, { ok: false, error: 'bad_context' }, allowOrigin);
      return true;
    }
    // Refund only if the match was never scored (died before round 1 — PRD §5.A).
    if (!isConsumed(mt.m)) {
      consume(mt.m);
      refundToken(ctx.u, new Date(mt.t).toISOString().slice(0, 10));
    }
    json(res, 200, { ok: true, tokens: tokensRemaining(ctx.u) }, allowOrigin);
    return true;
  }

  // -- GET /leaderboard ----------------------------------------------------
  if (req.method === 'GET' && url.pathname === '/leaderboard') {
    const ctx = ctxFrom(url.searchParams.get('gctx'));
    if (!ctx) {
      json(res, 401, { ok: false, error: 'bad_context' }, allowOrigin);
      return true;
    }
    json(res, 200, { ok: true, ...boardOf(ctx.u) }, allowOrigin);
    return true;
  }

  // -- GET /prizes ---------------------------------------------------------
  if (req.method === 'GET' && url.pathname === '/prizes') {
    json(res, 200, { ok: true, ...prizesView() }, allowOrigin);
    return true;
  }

  return false;
}
