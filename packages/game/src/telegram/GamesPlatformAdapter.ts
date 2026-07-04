import type { HapticKind, LeaderEntry, TelegramAdapter, TelegramUser } from './TelegramAdapter';

const GAMES_JS = 'https://telegram.org/js/games.js';
// Empty = same origin (the bot serves the game + API together) → relative '/score'.
// Set VITE_SCORE_API only when the API lives on a different host.
const SCORE_API = (import.meta.env.VITE_SCORE_API as string | undefined) ?? '';

interface GameProxy {
  initParams?: Record<string, unknown>;
  shareScore?: () => void;
}

/**
 * Telegram Games platform adapter (Path A — the contest target, SPEC §5.2).
 *
 * The bot appends a signed launch token to the game URL (`#tgctx=…`); we echo it
 * back to the bot's score API. The BOT_TOKEN that can write scores stays on the
 * server — this only ever holds the opaque signed token.
 */
export class GamesPlatformAdapter implements TelegramAdapter {
  private tgctx = '';

  async ready(): Promise<void> {
    this.tgctx = hashParam('tgctx') ?? '';
    await loadScript(GAMES_JS).catch(() => {
      /* games.js best-effort; the game still runs without it */
    });
  }

  getUser(): TelegramUser | null {
    return null; // identity for display comes from the server-side leaderboard
  }

  async submitScore(score: number): Promise<void> {
    if (!this.tgctx) return;
    await fetch(`${SCORE_API}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gctx: this.tgctx, score: Math.round(score) }),
    }).catch(() => {});
  }

  async getLeaderboard(): Promise<LeaderEntry[]> {
    if (!this.tgctx) return [];
    try {
      const res = await fetch(`${SCORE_API}/highscores?gctx=${encodeURIComponent(this.tgctx)}`);
      const data = (await res.json()) as {
        ok: boolean;
        scores?: Array<{ rank: number; name: string; score: number; isSelf: boolean }>;
      };
      if (!data.ok || !data.scores) return [];
      return data.scores.map((s) => ({ rank: s.rank, name: s.name, score: s.score, isSelf: s.isSelf }));
    } catch {
      return [];
    }
  }

  share(text?: string, url?: string): void {
    // A challenge carries a URL (the duel seed) — route it through Telegram's native
    // share sheet so the friend receives the exact same-puzzles link. A plain share
    // (no URL) re-shares the game message via the Games API.
    if (url) {
      const t = text ? `&text=${encodeURIComponent(text)}` : '';
      window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}${t}`, '_blank', 'noopener');
      return;
    }
    try {
      proxy()?.shareScore?.();
    } catch {
      /* no-op */
    }
  }

  haptic(_kind: HapticKind): void {
    // No haptics API on the Games platform (Mini App only).
  }

  openLink(url: string): void {
    window.open(url, '_blank', 'noopener');
  }

  getStartParam(): string | null {
    // Accept both spellings: challengeUrl writes ?startapp=…; `duel` kept for
    // compatibility with hand-built links.
    const q = new URLSearchParams(location.search);
    return (
      hashParam('startapp') ?? hashParam('duel') ?? q.get('startapp') ?? q.get('duel') ?? null
    );
  }
}

function proxy(): GameProxy | undefined {
  return (window as unknown as { TelegramGameProxy?: GameProxy }).TelegramGameProxy;
}

function hashParam(key: string): string | null {
  return new URLSearchParams(location.hash.replace(/^#/, '')).get(key);
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('script load failed'));
    document.head.appendChild(el);
  });
}
