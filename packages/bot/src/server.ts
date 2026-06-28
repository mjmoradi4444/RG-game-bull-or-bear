import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// Serve the built game (packages/game/dist) from the same origin as the API, so one
// HTTPS host covers both the webview and /score — and the frontend can call the API
// with relative paths. Build the game first (`npm run build -w @rebate-rush/game`).
const GAME_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'game', 'dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

async function serveStatic(res: ServerResponse, pathname: string): Promise<boolean> {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = normalize(join(GAME_DIST, decodeURIComponent(rel)));
  if (!filePath.startsWith(GAME_DIST)) return false; // no path traversal
  try {
    if (!(await stat(filePath)).isFile()) return false;
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(await readFile(filePath));
    return true;
  } catch {
    return false;
  }
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

  // Static game (and SPA fallback to index.html for extensionless routes).
  if (req.method === 'GET') {
    if (await serveStatic(res, url.pathname)) return;
    if (!extname(url.pathname) && (await serveStatic(res, '/index.html'))) return;
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
