import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A simple bot-side global leaderboard. We do NOT depend on Telegram's per-message
 * game high scores (setGameScore/getGameHighScores) for what the game renders —
 * those are scoped to a single game message and throw MESSAGE_ID_INVALID once that
 * message is stale/inline. Instead the bot keeps the best score per user here
 * (persisted to a small JSON file) and serves it from /highscores. setGameScore is
 * still called best-effort so Telegram's native in-chat board updates where it can.
 */
export interface Entry {
  u: number;
  name: string;
  score: number;
  ts: number;
}

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '.data', 'leaderboard.json');

const board = load();

function load(): Map<number, Entry> {
  try {
    if (existsSync(FILE)) {
      const arr = JSON.parse(readFileSync(FILE, 'utf8')) as Entry[];
      return new Map(arr.map((e) => [e.u, e]));
    }
  } catch {
    /* start fresh on a corrupt file */
  }
  return new Map();
}

function save(): void {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify([...board.values()]));
  } catch {
    /* non-fatal */
  }
}

/** Record a run; keep the user's best score. Returns the stored best. */
export function recordScore(u: number, name: string, score: number): number {
  const cur = board.get(u);
  const safeName = name || cur?.name || 'Player';
  if (!cur || score > cur.score) {
    board.set(u, { u, name: safeName, score, ts: Date.now() });
    save();
    return score;
  }
  if (cur.name !== safeName) {
    cur.name = safeName;
    save();
  }
  return cur.score;
}

export function topScores(limit = 50): Entry[] {
  return [...board.values()].sort((a, b) => b.score - a.score || a.ts - b.ts).slice(0, limit);
}
