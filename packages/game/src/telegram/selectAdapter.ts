import type { TelegramAdapter } from './TelegramAdapter';
import { NoopAdapter } from './NoopAdapter';

/**
 * Runtime adapter selection. Detects the host platform and returns the matching
 * TelegramAdapter.
 *
 * Only NoopAdapter exists in Phase 1. The Games-platform adapter (Path A, Phase 5)
 * and Mini App adapter (Path B, Phase 7) are wired in later; until then we
 * detect-and-log the platform, then fall back to Noop so the game always runs.
 */
export function selectAdapter(): TelegramAdapter {
  const w = window as unknown as {
    TelegramGameProxy?: unknown;
    Telegram?: { WebApp?: unknown };
  };

  if (w.TelegramGameProxy) {
    console.info('[adapter] Telegram Games platform detected — GamesPlatformAdapter pending (Phase 5).');
    // return new GamesPlatformAdapter();
  } else if (w.Telegram?.WebApp) {
    console.info('[adapter] Telegram Mini App detected — MiniAppAdapter pending (Phase 7).');
    // return new MiniAppAdapter();
  }

  return new NoopAdapter();
}
