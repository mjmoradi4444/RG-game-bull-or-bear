import type { IncomingMessage, ServerResponse } from 'node:http';
import { rateLimit, verifyContext, type GameContext } from './security';
import {
  claimTask,
  recordReferral,
  shareTaskEvent,
  tasksView,
  tgJoinChannel,
  visitTask,
} from './store';
import { bot } from './bot';

/**
 * Task system API (PRD-ONBOARDING-TASKS §7.7). Auth is the signed launch context.
 * Gameplay progress is computed server-side from match submissions (see
 * seasonRoutes); this surface only reads tasks, records click-claim visits and
 * shares, captures referral attribution, and pays out claims (idempotent).
 *
 *   GET  /tasks?gctx=…                  → { daily, general, resetAt, claimable }
 *   POST /tasks/claim {gctx, taskId, day?}  → { reward, newSeasonRp | newTokens } | 409
 *   POST /tasks/visit {gctx, taskId}    → starts the 30s click-claim timer
 *   POST /tasks/share {gctx}            → d_share progress
 *   POST /tasks/referral {gctx, ref}    → record who invited this player
 */
const READ_TTL_MS = 12 * 60 * 60 * 1000;

function json(res: ServerResponse, status: number, body: unknown, allowOrigin: string): void {
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function readBody(req: IncomingMessage, cap = 4096): Promise<string> {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > cap) throw new Error('body too large');
  }
  return data;
}
const ctxFrom = (raw: unknown): GameContext | null => verifyContext(String(raw ?? ''), READ_TTL_MS);

/** Is the user a member of the given @channel? Uses the bot's getChatMember. */
async function isChannelMember(channel: string, u: number): Promise<boolean> {
  if (!bot) return false;
  try {
    const chat = channel.startsWith('@') ? channel : `@${channel}`;
    const m = await bot.api.getChatMember(chat, u);
    return m.status === 'member' || m.status === 'administrator' || m.status === 'creator';
  } catch {
    return false;
  }
}

export async function handleTasks(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  allowOrigin: string,
): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/tasks') {
    const ctx = ctxFrom(url.searchParams.get('gctx'));
    if (!ctx) {
      json(res, 401, { ok: false, error: 'bad_context' }, allowOrigin);
      return true;
    }
    json(res, 200, { ok: true, ...tasksView(ctx.u, ctx.n) }, allowOrigin);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/tasks/claim') {
    const data = JSON.parse((await readBody(req)) || '{}') as { gctx?: string; taskId?: string; day?: string };
    const ctx = ctxFrom(data.gctx);
    if (!ctx) {
      json(res, 401, { ok: false, error: 'bad_context' }, allowOrigin);
      return true;
    }
    if (!rateLimit(ctx.u, 800)) {
      json(res, 429, { ok: false, error: 'rate_limited' }, allowOrigin);
      return true;
    }
    const taskId = String(data.taskId ?? '');
    // Telegram-join tasks verify membership live before claiming.
    let tgVerified: boolean | undefined;
    if (taskId === 'tg_join') {
      const channel = tgJoinChannel();
      tgVerified = channel ? await isChannelMember(channel, ctx.u) : false;
    }
    const result = claimTask(ctx.u, ctx.n ?? 'Player', taskId, data.day, tgVerified);
    if (!result.ok) {
      const status = result.error === 'already_claimed' ? 409 : result.error === 'tg_not_member' ? 403 : 409;
      json(res, status, { ok: false, error: result.error }, allowOrigin);
      return true;
    }
    json(res, 200, result, allowOrigin);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/tasks/visit') {
    const data = JSON.parse((await readBody(req)) || '{}') as { gctx?: string; taskId?: string };
    const ctx = ctxFrom(data.gctx);
    if (!ctx) {
      json(res, 401, { ok: false, error: 'bad_context' }, allowOrigin);
      return true;
    }
    visitTask(ctx.u, String(data.taskId ?? ''));
    json(res, 200, { ok: true }, allowOrigin);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/tasks/share') {
    const data = JSON.parse((await readBody(req)) || '{}') as { gctx?: string };
    const ctx = ctxFrom(data.gctx);
    if (!ctx) {
      json(res, 401, { ok: false, error: 'bad_context' }, allowOrigin);
      return true;
    }
    shareTaskEvent(ctx.u, ctx.n ?? 'Player');
    json(res, 200, { ok: true }, allowOrigin);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/tasks/referral') {
    const data = JSON.parse((await readBody(req)) || '{}') as { gctx?: string; ref?: number | string };
    const ctx = ctxFrom(data.gctx);
    if (!ctx) {
      json(res, 401, { ok: false, error: 'bad_context' }, allowOrigin);
      return true;
    }
    const ref = Number(data.ref);
    if (Number.isFinite(ref) && ref > 0) recordReferral(ctx.u, ref);
    json(res, 200, { ok: true }, allowOrigin);
    return true;
  }

  return false;
}
