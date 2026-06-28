import type {
  HapticKind,
  LeaderEntry,
  TelegramAdapter,
  TelegramUser,
} from './TelegramAdapter';

/**
 * Local-dev / plain-browser adapter. Implements the full contract with safe
 * no-ops and a mock leaderboard, so the entire game is playable in a normal
 * browser without any Telegram involvement (SPEC Definition of Done).
 */
export class NoopAdapter implements TelegramAdapter {
  async ready(): Promise<void> {
    // Nothing to boot in a plain browser.
  }

  getUser(): TelegramUser | null {
    return { id: 'local', name: 'You' };
  }

  async submitScore(rebate: number): Promise<void> {
    console.info('[NoopAdapter] submitScore(rebate =', rebate, ')');
  }

  async getLeaderboard(): Promise<LeaderEntry[]> {
    // Placeholder board for UI development; real boards come from the
    // Games / Mini App adapters in later phases.
    return [
      { rank: 1, name: 'Sara', score: 4820 },
      { rank: 2, name: 'You', score: 3110, isSelf: true },
      { rank: 3, name: 'Reza', score: 2640 },
      { rank: 4, name: 'Mina', score: 1900 },
      { rank: 5, name: 'Ali', score: 1450 },
    ];
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
}
