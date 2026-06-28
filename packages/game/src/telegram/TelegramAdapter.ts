/**
 * The ONE seam between the platform-agnostic game and Telegram.
 *
 * The engine never imports a Telegram API directly — everything platform-specific
 * goes through this interface, so the exact same game runs as a Games-platform
 * HTML5 game (Path A), a Mini App (Path B), or a plain browser build (Noop) with
 * zero changes to the engine. Keeping this separation is the whole architectural
 * point (SPEC §1).
 */

/** One row of the leaderboard. Score is always total rebate banked — never P&L. */
export interface LeaderEntry {
  rank: number;
  name: string;
  score: number;
  isSelf?: boolean;
}

export type HapticKind = 'success' | 'warning' | 'impact';

export interface TelegramUser {
  id?: string;
  name?: string;
}

export interface TelegramAdapter {
  /** Resolve once the platform SDK (if any) is ready and launch params are parsed. */
  ready(): Promise<void>;

  /** Best-effort identity for display; may be null in plain-browser dev. */
  getUser(): TelegramUser | null;

  /**
   * Submit the run's total rebate as the score.
   * Games platform → POST to the bot backend → setGameScore.
   * Mini App        → backend global leaderboard.
   */
  submitScore(rebate: number): Promise<void>;

  /** Fetch the leaderboard to render in-game. */
  getLeaderboard(): Promise<LeaderEntry[]>;

  /**
   * Share the game / a duel challenge (inline share on Games, WebApp share on Mini
   * App). Optional text + deep link let the async duel post "beat my score 👇".
   */
  share(text?: string, url?: string): void;

  /** Fire platform haptics on mobile; no-op on desktop / plain browser. */
  haptic(kind: HapticKind): void;

  /** Open an external link — used for the RebateGain sign-up CTA. */
  openLink(url: string): void;

  /**
   * The launch deep-link payload, if any — e.g. the `duel_<token>` carried by a
   * challenge link (`?startapp=` on Mini App, a URL param on Games). Null on a cold
   * open. Drives the async "challenge a friend" flow (SPEC §4.2).
   */
  getStartParam(): string | null;
}
