import type { IncomingMessage, ServerResponse } from 'node:http';
import { rateLimit, verifyContext, type GameContext } from './security';
import { cleanEmail, isValidEmail, normalizeEmail } from './email';
import { accountOf, deleteEmail, setEmail } from './store';

/**
 * In-game account/email capture (PRD-ADMIN-EMAIL §5.5). Auth is the existing
 * HMAC-signed launch context (`gctx`) — unchanged. The email is stored against the
 * Telegram user id as a matching hint for prize delivery; never verified in v1.
 *
 *   GET  /account?gctx=…              → { masked|null, changesLeft, emailSetAt, eligible }
 *   POST /account/email {gctx, email} → { ok, masked, changesLeft } | 400 | 409 | 401
 *   POST /account/delete {gctx}       → { ok } (self-service privacy — PRD §12 Q4)
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

export async function handleAccount(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  allowOrigin: string,
): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/account') {
    const ctx = ctxFrom(url.searchParams.get('gctx'));
    if (!ctx) {
      json(res, 401, { ok: false, error: 'bad_context' }, allowOrigin);
      return true;
    }
    json(res, 200, { ok: true, ...accountOf(ctx.u) }, allowOrigin);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/account/email') {
    const data = JSON.parse((await readBody(req)) || '{}') as { gctx?: string; email?: string };
    const ctx = ctxFrom(data.gctx);
    if (!ctx) {
      json(res, 401, { ok: false, error: 'bad_context' }, allowOrigin);
      return true;
    }
    // Anti-spam min-interval (the real abuse guard is the 3-changes-per-season cap
    // enforced in the store — PRD §5.3).
    if (!rateLimit(ctx.u, 3000)) {
      json(res, 429, { ok: false, error: 'rate_limited' }, allowOrigin);
      return true;
    }
    const email = cleanEmail(String(data.email ?? ''));
    if (!isValidEmail(email)) {
      json(res, 400, { ok: false, error: 'invalid_email' }, allowOrigin);
      return true;
    }
    const result = setEmail(ctx.u, ctx.n ?? 'Player', email, normalizeEmail(email), 'game');
    if (!result.ok) {
      json(res, 409, { ok: false, error: result.error }, allowOrigin);
      return true;
    }
    json(res, 200, { ok: true, masked: result.masked, changesLeft: result.changesLeft }, allowOrigin);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/account/delete') {
    const data = JSON.parse((await readBody(req)) || '{}') as { gctx?: string };
    const ctx = ctxFrom(data.gctx);
    if (!ctx) {
      json(res, 401, { ok: false, error: 'bad_context' }, allowOrigin);
      return true;
    }
    const ok = deleteEmail(ctx.u);
    json(res, ok ? 200 : 409, { ok, ...(ok ? {} : { error: 'frozen_or_absent' }) }, allowOrigin);
    return true;
  }

  return false;
}
