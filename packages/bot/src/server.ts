import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config';
import { bot } from './bot';
import { clampScore, rateLimit, verifyContext } from './security';
import { fetchHighScores, submitGameScore } from './telegram';

/**
 * Minimal HTTP API the frontend calls (SPEC §5.2):
 *   POST /score       { gctx, score } → verify context → setGameScore
 *   GET  /highscores  ?gctx=…         → getGameHighScores
 *   GET  /health
 * Every call must carry a bot-signed `gctx`; client scores are clamped (untrusted).
 */
function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', config.allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function send(res: ServerResponse, status: number, body: unknown): void {
  cors(res);
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

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/score') {
    const data = JSON.parse((await readBody(req)) || '{}') as { gctx?: string; score?: number };
    const ctx = verifyContext(String(data.gctx ?? ''));
    if (!ctx) return send(res, 401, { ok: false, error: 'bad_context' });
    if (!rateLimit(ctx.u)) return send(res, 429, { ok: false, error: 'rate_limited' });
    const score = clampScore(data.score);
    await submitGameScore(bot.api, ctx, score);
    return send(res, 200, { ok: true, score });
  }

  if (req.method === 'GET' && url.pathname === '/highscores') {
    const ctx = verifyContext(url.searchParams.get('gctx') ?? '');
    if (!ctx) return send(res, 401, { ok: false, error: 'bad_context' });
    const scores = await fetchHighScores(bot.api, ctx);
    return send(res, 200, { ok: true, scores });
  }

  send(res, 404, { ok: false, error: 'not_found' });
}

export function startServer(): void {
  const server = createServer((req, res) => {
    void handle(req, res).catch((e) => {
      console.error('[server]', e);
      send(res, 500, { ok: false, error: 'server_error' });
    });
  });
  server.listen(config.port, () => console.log(`[bot] score API on :${config.port}`));
}
