import type { TelegramAdapter } from './TelegramAdapter';
import { NoopAdapter } from './NoopAdapter';
import { GamesPlatformAdapter } from './GamesPlatformAdapter';

/**
 * Runtime adapter selection. The bot appends a signed `#tgctx=…` to the game URL on
 * a real Games-platform launch, so that hash is the reliable signal (it's present
 * before games.js finishes loading TelegramGameProxy). Mini App (Path B) detection
 * is wired later; everything else falls back to Noop so the game always runs.
 */
export function selectAdapter(): TelegramAdapter {
  const hash = location.hash;
  const w = window as unknown as { Telegram?: { WebApp?: unknown } };

  if (/(?:^|#|&)tgctx=/.test(hash)) {
    return new GamesPlatformAdapter();
  }
  if (w.Telegram?.WebApp) {
    console.info('[adapter] Telegram Mini App detected — MiniAppAdapter pending (Phase 7).');
  }
  return new NoopAdapter();
}
