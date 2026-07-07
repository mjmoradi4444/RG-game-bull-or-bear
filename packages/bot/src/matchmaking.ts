import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { verifyContext } from './security';

/**
 * Live 1-v-1 matchmaking over WebSocket (path /mm on the same HTTP server).
 *
 * Flow: a client queues for a difficulty level → the first two players in the same
 * queue are paired → both receive the SAME match seed (so their clients pick the
 * exact same puzzles) plus each other's Telegram profile (name + avatar URL) for
 * the VS screen → each client reports its per-round result → when both finish, the
 * server declares the winner. Ties trigger SUDDEN DEATH extra rounds (both clients
 * hold reserve puzzles from the same seed), and a still-tied match after the cap is
 * decided by total decision time (faster wins — SPEC §4.3).
 *
 * Identity: clients send their signed game context (gctx) when they have one
 * (launched from the bot), which yields the real Telegram name + user id for the
 * avatar; plain-browser players fall back to a self-reported display name.
 */
type Level = 'retail' | 'pro' | 'whale';
const LEVELS: readonly Level[] = ['retail', 'pro', 'whale'];
const ROUNDS = 5;
const MAX_SUDDEN = 3;
const MAX_NAME = 18;
/** Accept queue auth tokens for a whole session window. */
const GCTX_TTL_MS = 12 * 60 * 60 * 1000;

interface RoundRes {
  correct: boolean;
  ms: number;
}

interface Player {
  ws: WebSocket;
  uid: number | null;
  name: string;
  match: LiveMatch | null;
  queuedLevel: Level | null;
}

interface Side {
  p: Player;
  rounds: Map<number, RoundRes>;
}

interface LiveMatch {
  id: string;
  seed: number;
  level: Level;
  /** Rounds each side must report before evaluation (grows on sudden death). */
  expect: number;
  sudden: number;
  sides: [Side, Side];
  finished: boolean;
}

const queues = new Map<Level, Player[]>(LEVELS.map((l) => [l, []]));

function send(ws: WebSocket, msg: unknown): void {
  try {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  } catch {
    /* peer gone — close handler cleans up */
  }
}

function profileOf(p: Player): { name: string; avatar: string | null } {
  return { name: p.name, avatar: p.uid !== null ? `/avatar/${p.uid}` : null };
}

function dequeue(p: Player): void {
  if (!p.queuedLevel) return;
  const q = queues.get(p.queuedLevel)!;
  const i = q.indexOf(p);
  if (i >= 0) q.splice(i, 1);
  p.queuedLevel = null;
}

function createMatch(a: Player, b: Player, level: Level): void {
  const match: LiveMatch = {
    id: randomBytes(8).toString('hex'),
    seed: (randomBytes(4).readUInt32BE(0) >>> 0) || 1,
    level,
    expect: ROUNDS,
    sudden: 0,
    sides: [
      { p: a, rounds: new Map() },
      { p: b, rounds: new Map() },
    ],
    finished: false,
  };
  a.match = match;
  b.match = match;
  console.log(`[mm] match ${match.id} · ${level} · ${a.name} vs ${b.name} · seed ${match.seed}`);
  send(a.ws, { t: 'matched', matchId: match.id, seed: match.seed, level, you: profileOf(a), opp: profileOf(b) });
  send(b.ws, { t: 'matched', matchId: match.id, seed: match.seed, level, you: profileOf(b), opp: profileOf(a) });
}

function scoreOf(s: Side, upTo: number): { score: number; ms: number } {
  let score = 0;
  let ms = 0;
  for (let n = 1; n <= upTo; n++) {
    const r = s.rounds.get(n);
    if (!r) continue;
    if (r.correct) score++;
    ms += r.ms;
  }
  return { score, ms };
}

function evaluate(match: LiveMatch): void {
  if (match.finished) return;
  const [sa, sb] = match.sides;
  if (sa.rounds.size < match.expect || sb.rounds.size < match.expect) return;

  const ra = scoreOf(sa, match.expect);
  const rb = scoreOf(sb, match.expect);

  // Tie → sudden death (both clients hold reserve puzzles from the same seed).
  if (ra.score === rb.score && match.sudden < MAX_SUDDEN) {
    match.sudden++;
    match.expect++;
    console.log(`[mm] match ${match.id} tied ${ra.score}-${rb.score} → sudden death round ${match.expect}`);
    for (const s of match.sides) send(s.p.ws, { t: 'sudden', round: match.expect });
    return;
  }

  match.finished = true;
  let winner: 0 | 1 | null = null;
  let onTime = false;
  if (ra.score !== rb.score) winner = ra.score > rb.score ? 0 : 1;
  else if (ra.ms !== rb.ms) {
    winner = ra.ms < rb.ms ? 0 : 1; // still tied after sudden death → faster total time
    onTime = true;
  }
  const res = [ra, rb] as const;
  match.sides.forEach((s, i) => {
    const w = winner === null ? 'tie' : winner === i ? 'you' : 'opp';
    send(s.p.ws, { t: 'final', you: res[i], opp: res[1 - i], winner: w, onTime, sudden: match.sudden });
  });
  console.log(`[mm] match ${match.id} final ${ra.score}-${rb.score}${onTime ? ' (time)' : ''}`);
  for (const s of match.sides) s.p.match = null;
}

function forfeit(match: LiveMatch, leaver: Player): void {
  if (match.finished) return;
  match.finished = true;
  const other = match.sides.find((s) => s.p !== leaver)?.p;
  if (other) {
    const os = match.sides.find((s) => s.p === other)!;
    const upTo = Math.min(match.expect, os.rounds.size);
    send(other.ws, {
      t: 'final',
      you: scoreOf(os, upTo || 1),
      opp: { score: 0, ms: 0 },
      winner: 'you',
      forfeit: true,
    });
    other.match = null;
  }
  console.log(`[mm] match ${match.id} forfeit by ${leaver.name}`);
}

interface QueueMsg {
  t: 'queue';
  level?: string;
  gctx?: string;
  name?: string;
}
interface RoundMsg {
  t: 'round';
  n?: number;
  correct?: boolean;
  ms?: number;
}

export function attachMatchmaking(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/mm' });

  wss.on('connection', (ws) => {
    const player: Player = { ws, uid: null, name: 'Player', match: null, queuedLevel: null };

    ws.on('message', (raw) => {
      let msg: QueueMsg | RoundMsg | { t: 'leave' };
      try {
        msg = JSON.parse(String(raw)) as typeof msg;
      } catch {
        return;
      }

      if (msg.t === 'queue') {
        if (player.match || player.queuedLevel) return; // already busy
        const level = (LEVELS as readonly string[]).includes(msg.level ?? '')
          ? (msg.level as Level)
          : 'pro';
        // Identity: prefer the bot-signed context; fall back to a display name.
        const ctx = msg.gctx ? verifyContext(msg.gctx, GCTX_TTL_MS) : null;
        if (ctx) {
          player.uid = ctx.u;
          player.name = (ctx.n ?? 'Player').slice(0, MAX_NAME);
        } else if (typeof msg.name === 'string' && msg.name.trim()) {
          player.name = msg.name.trim().slice(0, MAX_NAME);
        }
        const q = queues.get(level)!;
        const opponent = q.shift();
        if (opponent && opponent.ws.readyState === opponent.ws.OPEN) {
          opponent.queuedLevel = null;
          createMatch(opponent, player, level);
        } else {
          player.queuedLevel = level;
          q.push(player);
          send(ws, { t: 'queued', level });
        }
        return;
      }

      if (msg.t === 'round') {
        const m = player.match;
        if (!m || m.finished) return;
        const n = Math.floor(Number(msg.n));
        if (!Number.isFinite(n) || n < 1 || n > m.expect) return;
        const side = m.sides.find((s) => s.p === player)!;
        if (side.rounds.has(n)) return; // one report per round
        side.rounds.set(n, {
          correct: msg.correct === true,
          ms: Math.max(0, Math.min(120_000, Number(msg.ms) || 0)),
        });
        const other = m.sides.find((s) => s.p !== player)!;
        send(other.p.ws, { t: 'opp', n, correct: msg.correct === true });
        evaluate(m);
        return;
      }

      if (msg.t === 'leave') {
        dequeue(player);
        send(ws, { t: 'left' });
      }
    });

    ws.on('close', () => {
      dequeue(player);
      if (player.match) forfeit(player.match, player);
    });
    ws.on('error', () => {
      dequeue(player);
      if (player.match) forfeit(player.match, player);
    });
  });

  console.log('[mm] matchmaking WebSocket ready on /mm');
}
