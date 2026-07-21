import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { verifyContext } from './security';

/**
 * Live 1-v-1 matchmaking over PLAIN HTTP POLLING (no WebSocket).
 *
 * Why polling: the game must run behind arbitrary reverse proxies the operator may
 * not control. The score API (/score) provably passes those proxies, so matchmaking
 * uses the exact same transport: small JSON requests on the same origin. A client
 * polls /mm/state every ~1.5s — plenty for a game that only exchanges round results.
 *
 * Flow: POST /mm/queue (level + identity) → the first two players in a level queue
 * are paired and both get the SAME match seed (their clients pick identical puzzles)
 * plus each other's profile for the VS screen. Each client POSTs its per-round
 * result; when both sides finish, the server declares the winner. Ties trigger
 * SUDDEN DEATH extra rounds (max 3), then total decision time decides (SPEC §4.3).
 *
 * Bot fill: if no human shows up within ~6–10s, an AI opponent (human-like name,
 * ~coin-flip accuracy, realistic timing) fills the seat so the mode always works.
 * Two humans queueing together always match each other first.
 *
 * Identity: clients send their signed game context (gctx) when launched from the
 * bot → real Telegram name + user id (avatar via /avatar/:uid); plain-browser
 * players fall back to a self-reported name.
 */
type Level = 'retail' | 'pro' | 'whale';
const LEVELS: readonly Level[] = ['retail', 'pro', 'whale'];
const ROUNDS = 5;
const MAX_SUDDEN = 3;
const MAX_NAME = 18;
const GCTX_TTL_MS = 12 * 60 * 60 * 1000;

/** Queue wait before an AI opponent fills in (randomized so it feels like a lobby).
 *  Env-overridable so tests can shrink the clock. */
const BOT_FILL_MIN_MS = Number(process.env.MM_BOT_FILL_MS ?? 6_000);
const BOT_FILL_JITTER_MS = Number(process.env.MM_BOT_JITTER_MS ?? 4_000);
/** AI per-round pacing (base + jitter). */
const BOT_ROUND_MS = Number(process.env.MM_BOT_ROUND_MS ?? 5_000);
const BOT_ROUND_JITTER_MS = Number(process.env.MM_BOT_ROUND_JITTER_MS ?? 8_000);
/** A queued player whose client stopped polling is dropped after this. */
const QUEUE_STALE_MS = 12_000;
/** A matched player whose client stopped polling forfeits after this. */
const MATCH_STALE_MS = 30_000;

const BOT_NAMES = ['Alex', 'Nova', 'Marcus', 'Leila', 'Yuki', 'Omar', 'Petra', 'Dario', 'Mina', 'Tomas'];

interface RoundRes {
  correct: boolean;
  ms: number;
}

interface Profile {
  name: string;
  avatar: string | null;
}

interface FinalPayload {
  you: { score: number; ms: number };
  opp: { score: number; ms: number };
  winner: 'you' | 'opp' | 'tie';
  onTime: boolean;
  forfeit?: boolean;
  sudden: number;
}

interface Side {
  pid: string; // player id, or "bot:<name>" for the AI seat
  isBot: boolean;
  profile: Profile;
  rounds: Map<number, RoundRes>;
  final: FinalPayload | null;
}

interface LiveMatch {
  id: string;
  seed: number;
  level: Level;
  expect: number;
  sudden: number;
  finished: boolean;
  sides: [Side, Side];
}

interface Player {
  id: string;
  profile: Profile;
  level: Level | null; // set while queued
  botFillAt: number; // when queued: timestamp for the AI fill
  matchId: string | null;
  lastSeen: number;
  gone: boolean;
}

const players = new Map<string, Player>();
const matches = new Map<string, LiveMatch>();
const queues = new Map<Level, string[]>(LEVELS.map((l) => [l, []]));

const now = (): number => Date.now();
const rid = (n: number): string => randomBytes(n).toString('hex');

// ---- engine ----------------------------------------------------------------

function dequeue(p: Player): void {
  if (p.level === null) return;
  const q = queues.get(p.level)!;
  const i = q.indexOf(p.id);
  if (i >= 0) q.splice(i, 1);
  p.level = null;
}

function sideFor(match: LiveMatch, pid: string): Side | undefined {
  return match.sides.find((s) => s.pid === pid);
}

function createMatch(level: Level, a: Player, b: Player | null): LiveMatch {
  const botProfile: Profile = {
    name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]!,
    avatar: null,
  };
  const match: LiveMatch = {
    id: rid(8),
    seed: (randomBytes(4).readUInt32BE(0) >>> 0) || 1,
    level,
    expect: ROUNDS,
    sudden: 0,
    finished: false,
    sides: [
      { pid: a.id, isBot: false, profile: a.profile, rounds: new Map(), final: null },
      b
        ? { pid: b.id, isBot: false, profile: b.profile, rounds: new Map(), final: null }
        : { pid: `bot:${rid(4)}`, isBot: true, profile: botProfile, rounds: new Map(), final: null },
    ],
  };
  matches.set(match.id, match);
  dequeue(a);
  a.matchId = match.id;
  if (b) {
    dequeue(b);
    b.matchId = match.id;
  } else {
    // The AI plays its regular rounds on its own clock, like a human on the other
    // phone would (5–13s per decision).
    scheduleBotRounds(match, ROUNDS, 1);
  }
  console.log(
    `[mm] match ${match.id} · ${level} · ${match.sides[0].profile.name} vs ${match.sides[1].profile.name}${b ? '' : ' (AI)'} · seed ${match.seed}`,
  );
  return match;
}

function botAccuracy(level: Level): number {
  // Near coin-flip, slightly kinder on Retail — the duel stays winnable and honest.
  return level === 'retail' ? 0.45 : level === 'pro' ? 0.5 : 0.55;
}

function scheduleBotRounds(match: LiveMatch, upTo: number, fromRound: number): void {
  const bot = match.sides.find((s) => s.isBot);
  if (!bot) return;
  let delay = 0;
  for (let n = fromRound; n <= upTo; n++) {
    delay += BOT_ROUND_MS + Math.random() * BOT_ROUND_JITTER_MS; // per-round "thinking" time
    const roundN = n;
    setTimeout(() => {
      if (match.finished || bot.rounds.has(roundN)) return;
      bot.rounds.set(roundN, {
        correct: Math.random() < botAccuracy(match.level),
        ms: 4_000 + Math.random() * 8_000,
      });
      evaluate(match);
    }, delay).unref?.();
  }
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

  // Tie → sudden death: one more shared round (clients hold reserves from the seed).
  if (ra.score === rb.score && match.sudden < MAX_SUDDEN) {
    match.sudden++;
    match.expect++;
    console.log(`[mm] match ${match.id} tied ${ra.score}-${rb.score} → sudden death round ${match.expect}`);
    const bot = match.sides.find((s) => s.isBot);
    if (bot) scheduleBotRounds(match, match.expect, match.expect);
    return;
  }

  finish(match, (side) => {
    const mine = side === sa ? ra : rb;
    const theirs = side === sa ? rb : ra;
    const winner: 'you' | 'opp' | 'tie' =
      mine.score !== theirs.score
        ? mine.score > theirs.score
          ? 'you'
          : 'opp'
        : mine.ms !== theirs.ms
          ? mine.ms < theirs.ms
            ? 'you'
            : 'opp'
          : 'tie';
    return {
      you: mine,
      opp: theirs,
      winner,
      onTime: mine.score === theirs.score && mine.ms !== theirs.ms,
      sudden: match.sudden,
    };
  });
  const f = sa.final!;
  console.log(`[mm] match ${match.id} final ${f.you.score}-${f.opp.score}${f.onTime ? ' (time)' : ''}`);
}

function finish(match: LiveMatch, payload: (side: Side) => FinalPayload): void {
  match.finished = true;
  for (const side of match.sides) side.final = payload(side);
}

function forfeit(match: LiveMatch, leaverPid: string): void {
  if (match.finished) return;
  const leaver = sideFor(match, leaverPid);
  if (!leaver) return;
  finish(match, (side) => ({
    you: scoreOf(side, match.expect),
    opp: scoreOf(side === match.sides[0] ? match.sides[1] : match.sides[0], match.expect),
    winner: side === leaver ? 'opp' : 'you',
    onTime: false,
    forfeit: true,
    sudden: match.sudden,
  }));
  console.log(`[mm] match ${match.id} forfeit by ${leaver.profile.name}`);
}

/** Periodic sweep: bot-fill overdue queuers, reap silent players. */
function sweep(): void {
  const t = now();
  for (const p of players.values()) {
    if (p.gone) continue;
    if (p.level !== null) {
      if (t - p.lastSeen > QUEUE_STALE_MS) {
        dequeue(p);
        p.gone = true;
      } else if (t >= p.botFillAt) {
        createMatch(p.level, p, null);
      }
    } else if (p.matchId) {
      const m = matches.get(p.matchId);
      if (m && !m.finished && t - p.lastSeen > MATCH_STALE_MS) {
        forfeit(m, p.id);
        p.gone = true;
      }
    }
  }
  // Drop finished matches / gone players after a grace period (memory hygiene).
  for (const [id, m] of matches) {
    if (m.finished && m.sides.every((s) => s.isBot || (players.get(s.pid)?.lastSeen ?? 0) < t - 120_000)) {
      matches.delete(id);
      for (const s of m.sides) if (!s.isBot) players.delete(s.pid);
    }
  }
}
setInterval(sweep, 1_000).unref?.();

// ---- HTTP surface ----------------------------------------------------------

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

/**
 * Route /mm/* requests. Returns true when the request was handled here.
 *   POST /mm/queue  { level, gctx?, name? }        → { ok, pid }
 *   GET  /mm/state?pid=…                            → full player-visible state
 *   POST /mm/round  { pid, n, correct, ms }         → { ok }
 *   POST /mm/leave  { pid }                         → { ok }
 */
export async function handleMatchmaking(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  allowOrigin: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/mm/')) return false;

  if (req.method === 'POST' && url.pathname === '/mm/queue') {
    const data = JSON.parse((await readBody(req)) || '{}') as {
      level?: string;
      gctx?: string;
      name?: string;
    };
    const level = (LEVELS as readonly string[]).includes(data.level ?? '') ? (data.level as Level) : 'pro';
    const ctx = data.gctx ? verifyContext(String(data.gctx), GCTX_TTL_MS) : null;
    const profile: Profile = ctx
      ? { name: (ctx.n ?? 'Player').slice(0, MAX_NAME), avatar: `/avatar/${ctx.u}` }
      : { name: (String(data.name ?? 'Player').trim() || 'Player').slice(0, MAX_NAME), avatar: null };

    const p: Player = {
      id: rid(12),
      profile,
      level: null,
      botFillAt: now() + BOT_FILL_MIN_MS + Math.random() * BOT_FILL_JITTER_MS,
      matchId: null,
      lastSeen: now(),
      gone: false,
    };
    players.set(p.id, p);

    // Pair with a waiting live human, else queue (the sweeper bot-fills later).
    const q = queues.get(level)!;
    let opponent: Player | undefined;
    while (q.length > 0 && !opponent) {
      const cand = players.get(q[0]!);
      if (cand && !cand.gone && now() - cand.lastSeen <= QUEUE_STALE_MS) opponent = cand;
      else q.shift(); // stale entry
    }
    if (opponent) {
      createMatch(level, opponent, p);
    } else {
      p.level = level;
      q.push(p.id);
    }
    json(res, 200, { ok: true, pid: p.id }, allowOrigin);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/mm/state') {
    const p = players.get(url.searchParams.get('pid') ?? '');
    if (!p || p.gone) {
      json(res, 200, { ok: false, error: 'unknown_pid' }, allowOrigin);
      return true;
    }
    p.lastSeen = now();
    if (!p.matchId) {
      json(res, 200, { ok: true, state: 'queued' }, allowOrigin);
      return true;
    }
    const m = matches.get(p.matchId);
    const side = m && sideFor(m, p.id);
    if (!m || !side) {
      json(res, 200, { ok: false, error: 'match_gone' }, allowOrigin);
      return true;
    }
    const opp = m.sides[0] === side ? m.sides[1] : m.sides[0];
    json(
      res,
      200,
      {
        ok: true,
        state: 'matched',
        matchId: m.id,
        seed: m.seed,
        level: m.level,
        expect: m.expect,
        you: side.profile,
        opp: opp.profile,
        // AI-fill wins pay a halved RP bonus (PRD §5.B) — the client needs to know
        // which bonus to claim; the UI never announces the opponent as a bot.
        oppAi: opp.isBot,
        oppRounds: [...opp.rounds.entries()].map(([n, r]) => ({ n, correct: r.correct })),
        final: side.final,
      },
      allowOrigin,
    );
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/mm/round') {
    const data = JSON.parse((await readBody(req)) || '{}') as {
      pid?: string;
      n?: number;
      correct?: boolean;
      ms?: number;
    };
    const p = players.get(String(data.pid ?? ''));
    const m = p?.matchId ? matches.get(p.matchId) : undefined;
    const side = m && p ? sideFor(m, p.id) : undefined;
    if (!p || !m || !side || m.finished) {
      json(res, 200, { ok: false }, allowOrigin);
      return true;
    }
    p.lastSeen = now();
    const n = Math.floor(Number(data.n));
    if (Number.isFinite(n) && n >= 1 && n <= m.expect && !side.rounds.has(n)) {
      side.rounds.set(n, {
        correct: data.correct === true,
        ms: Math.max(0, Math.min(120_000, Number(data.ms) || 0)),
      });
      evaluate(m);
    }
    json(res, 200, { ok: true }, allowOrigin);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/mm/leave') {
    const data = JSON.parse((await readBody(req)) || '{}') as { pid?: string };
    const p = players.get(String(data.pid ?? ''));
    if (p) {
      dequeue(p);
      const m = p.matchId ? matches.get(p.matchId) : undefined;
      if (m && !m.finished) forfeit(m, p.id);
      p.gone = true;
    }
    json(res, 200, { ok: true }, allowOrigin);
    return true;
  }

  json(res, 404, { ok: false, error: 'not_found' }, allowOrigin);
  return true;
}
