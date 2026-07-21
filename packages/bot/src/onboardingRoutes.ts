import type { IncomingMessage, ServerResponse } from 'node:http';
import { verifyContext, type GameContext } from './security';
import { isNewPlayer, markTipSeen, onboardingOf, setTutorial } from './store';

/**
 * Onboarding state (PRD-ONBOARDING-TASKS §5). Tutorial completion is remembered
 * SERVER-SIDE so a reinstall / second device doesn't re-force the FTUE. Auth is
 * the signed launch context.
 *
 *   GET  /onboarding?gctx=…                       → { tutorialDone, skipped, seenTips, isNew }
 *   POST /onboarding/tutorial {gctx, done, skipped}
 *   POST /onboarding/tip {gctx, tip}              → mark a one-time tooltip seen
 */
const READ_TTL_MS = 12 * 60 * 60 * 1000;

function json(res: ServerResponse, status: number, body: unknown, allowOrigin: string): void {
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function readBody(req: IncomingMessage, cap = 2048): Promise<string> {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > cap) throw new Error('body too large');
  }
  return data;
}
const ctxFrom = (raw: unknown): GameContext | null => verifyContext(String(raw ?? ''), READ_TTL_MS);

export async function handleOnboarding(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  allowOrigin: string,
): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/onboarding') {
    const ctx = ctxFrom(url.searchParams.get('gctx'));
    if (!ctx) {
      json(res, 401, { ok: false, error: 'bad_context' }, allowOrigin);
      return true;
    }
    json(res, 200, { ok: true, ...onboardingOf(ctx.u, ctx.n), isNew: isNewPlayer(ctx.u) }, allowOrigin);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/onboarding/tutorial') {
    const data = JSON.parse((await readBody(req)) || '{}') as { gctx?: string; done?: boolean; skipped?: boolean };
    const ctx = ctxFrom(data.gctx);
    if (!ctx) {
      json(res, 401, { ok: false, error: 'bad_context' }, allowOrigin);
      return true;
    }
    setTutorial(ctx.u, ctx.n ?? 'Player', data.done === true, data.skipped === true);
    json(res, 200, { ok: true }, allowOrigin);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/onboarding/tip') {
    const data = JSON.parse((await readBody(req)) || '{}') as { gctx?: string; tip?: string };
    const ctx = ctxFrom(data.gctx);
    if (!ctx) {
      json(res, 401, { ok: false, error: 'bad_context' }, allowOrigin);
      return true;
    }
    if (data.tip) markTipSeen(ctx.u, String(data.tip).slice(0, 40));
    json(res, 200, { ok: true }, allowOrigin);
    return true;
  }

  return false;
}
