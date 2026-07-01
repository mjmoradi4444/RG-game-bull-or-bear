import type {
  HapticKind,
  LeaderEntry,
  TelegramAdapter,
  TelegramUser,
} from './TelegramAdapter';

const STORE_KEY = 'bob_leaderboard_v1';
const SELF_ID = 'self';

interface Row {
  id: string;
  name: string;
  score: number;
}

// A few static rivals so the board looks alive before/around the player's runs.
// Scores are in the weighted range (5 rounds × up to ×3 = 15).
const RIVALS: Row[] = [
  { id: 'r1', name: 'Sara', score: 14 },
  { id: 'r2', name: 'Kenji', score: 12 },
  { id: 'r3', name: 'Mara', score: 11 },
  { id: 'r4', name: 'Diego', score: 9 },
  { id: 'r5', name: 'Priya', score: 7 },
];

/**
 * Local-dev / plain-browser adapter. Everything runs without Telegram, and — unlike
 * a true no-op — the player's best score is PERSISTED to localStorage and shown on a
 * real (local) leaderboard, so solo/browser play actually saves. In production the
 * Games-platform adapter persists server-side via the bot instead.
 */
export class NoopAdapter implements TelegramAdapter {
  async ready(): Promise<void> {
    // Nothing to boot in a plain browser.
  }

  getUser(): TelegramUser | null {
    return { id: SELF_ID, name: 'You' };
  }

  async submitScore(score: number): Promise<void> {
    const rows = this.load();
    const me = rows.find((r) => r.id === SELF_ID);
    if (!me) rows.push({ id: SELF_ID, name: 'You', score });
    else me.score = Math.max(me.score, score);
    this.save(rows);
  }

  async getLeaderboard(): Promise<LeaderEntry[]> {
    const rows = this.load();
    const merged = [...rows, ...RIVALS.filter((rv) => !rows.some((r) => r.id === rv.id))];
    merged.sort((a, b) => b.score - a.score);
    return merged.map((r, i) => ({
      rank: i + 1,
      name: r.name,
      score: r.score,
      isSelf: r.id === SELF_ID,
    }));
  }

  share(text?: string, url?: string): void {
    console.info('[NoopAdapter] share()', text, url);
    if (url) void navigator.clipboard?.writeText(url).catch(() => {});
  }

  haptic(kind: HapticKind): void {
    console.info('[NoopAdapter] haptic(', kind, ')');
  }

  openLink(url: string): void {
    console.info('[NoopAdapter] openLink(', url, ')');
    window.open(url, '_blank', 'noopener');
  }

  /** Local dev: read the challenge payload from `?startapp=` / `?duel=` on the URL. */
  getStartParam(): string | null {
    const q = new URLSearchParams(window.location.search);
    return q.get('startapp') ?? q.get('duel') ?? null;
  }

  private load(): Row[] {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? (JSON.parse(raw) as Row[]) : [];
    } catch {
      return [];
    }
  }

  private save(rows: Row[]): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(rows));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }
}
