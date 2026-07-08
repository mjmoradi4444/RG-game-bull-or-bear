import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config';
import { bot } from './bot';
import { clampScore, rateLimit, verifyContext } from './security';
import { submitGameScore } from './telegram';
import { recordScore, topScores } from './leaderboard';
import { handleMatchmaking } from './matchmaking';

// Signed launch tokens are accepted for 30 min (one match + browsing), not 24h —
// tightens the replay window since the token rides in the game URL fragment.
const SCORE_TTL_MS = 30 * 60 * 1000;

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

  // Live 1-v-1 matchmaking (plain HTTP polling — proxy-proof; see matchmaking.ts).
  if (await handleMatchmaking(req, res, url, config.allowOrigin)) return;

  if (req.method === 'POST' && url.pathname === '/score') {
    const data = JSON.parse((await readBody(req)) || '{}') as { gctx?: string; score?: number };
    const ctx = verifyContext(String(data.gctx ?? ''), SCORE_TTL_MS);
    if (!ctx) return send(res, 401, { ok: false, error: 'bad_context' });
    if (!rateLimit(ctx.u)) return send(res, 429, { ok: false, error: 'rate_limited' });
    const score = clampScore(data.score);
    const best = recordScore(ctx.u, ctx.n ?? 'Player', score);
    // Native Telegram in-chat score too, best-effort (ignore MESSAGE_ID_INVALID on stale msgs).
    if (bot) {
      void submitGameScore(bot.api, ctx, score).catch((e) =>
        console.warn('[score] setGameScore skipped:', e instanceof Error ? e.message : e),
      );
    }
    return send(res, 200, { ok: true, score: best });
  }

  if (req.method === 'GET' && url.pathname === '/highscores') {
    const ctx = verifyContext(url.searchParams.get('gctx') ?? '', SCORE_TTL_MS);
    if (!ctx) return send(res, 401, { ok: false, error: 'bad_context' });
    const scores = topScores().map((e, i) => ({ rank: i + 1, name: e.name, score: e.score, isSelf: e.u === ctx.u }));
    return send(res, 200, { ok: true, scores });
  }

  // Telegram profile photo proxy for the multiplayer VS screen. The photo is
  // fetched with the bot token SERVER-side and re-served from here, so the token
  // never appears in any URL the client sees.
  const avatarMatch = /^\/avatar\/(\d{1,15})$/.exec(url.pathname);
  if (req.method === 'GET' && avatarMatch) {
    const buf = await fetchAvatar(Number(avatarMatch[1]));
    if (!buf) return send(res, 404, { ok: false, error: 'no_avatar' });
    cors(res);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' });
    res.end(buf);
    return;
  }

  // Static game (and SPA fallback to index.html for extensionless routes).
  if (req.method === 'GET') {
    if (await serveStatic(res, url.pathname)) return;
    if (!extname(url.pathname) && (await serveStatic(res, '/index.html'))) return;
  }

  send(res, 404, { ok: false, error: 'not_found' });
}

// In-memory avatar cache (1h) so we don't hammer the Bot API per VS screen.
const avatarCache = new Map<number, { buf: Buffer | null; exp: number }>();
async function fetchAvatar(uid: number): Promise<Buffer | null> {
  const hit = avatarCache.get(uid);
  if (hit && hit.exp > Date.now()) return hit.buf;
  let buf: Buffer | null = null;
  try {
    if (bot) {
      const photos = await bot.api.getUserProfilePhotos(uid, { limit: 1 });
      const sizes = photos.photos[0];
      const fileId = sizes?.[Math.min(1, sizes.length - 1)]?.file_id; // small-ish size
      if (fileId) {
        const f = await bot.api.getFile(fileId);
        if (f.file_path) {
          const r = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${f.file_path}`);
          if (r.ok) buf = Buffer.from(await r.arrayBuffer());
        }
      }
    }
  } catch {
    buf = null; // private/no photo → client falls back to an initial-letter circle
  }
  avatarCache.set(uid, { buf, exp: Date.now() + 3600_000 });
  return buf;
}

export function startServer(): void {
  const server = createServer((req, res) => {
    void handle(req, res).catch((e) => {
      console.error('[server]', e);
      send(res, 500, { ok: false, error: 'server_error' });
    });
  });
  server.listen(config.port, () => console.log(`[bot] score API + matchmaking on :${config.port}`));
}
