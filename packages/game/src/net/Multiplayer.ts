import type { LevelId } from '../game/levels';

/**
 * Client for the live 1-v-1 matchmaking WebSocket (bot server, path /mm).
 *
 * Pure networking — no Telegram imports, no engine imports. The Game drives it:
 * queue(level) → onMatched (seed + both profiles for the VS screen) → sendRound()
 * per round → onSudden (tie → extra round) → onFinal (winner). Identity: the signed
 * game context from the URL hash when launched from the bot (server verifies it and
 * resolves the real Telegram name/avatar), else a display-name fallback.
 */
export interface MpProfile {
  name: string;
  /** Relative avatar URL (e.g. /avatar/123) or null → initial-letter fallback. */
  avatar: string | null;
}

export interface MpMatched {
  matchId: string;
  seed: number;
  level: LevelId;
  you: MpProfile;
  opp: MpProfile;
}

export interface MpFinal {
  you: { score: number; ms: number };
  opp: { score: number; ms: number };
  winner: 'you' | 'opp' | 'tie';
  onTime?: boolean;
  forfeit?: boolean;
  sudden?: number;
}

export interface MpHandlers {
  onQueued?: () => void;
  onMatched?: (m: MpMatched) => void;
  onOppRound?: (n: number, correct: boolean) => void;
  onSudden?: (round: number) => void;
  onFinal?: (f: MpFinal) => void;
  /** Socket dropped/errored before a final was delivered. */
  onDrop?: () => void;
}

// Same base the score API uses: same origin in production (bot serves the game),
// VITE_SCORE_API when the API lives elsewhere (e.g. local dev).
const API_BASE = ((import.meta.env.VITE_SCORE_API as string | undefined) ?? '').replace(/\/$/, '');

export function apiBase(): string {
  return API_BASE || window.location.origin;
}

function wsUrl(): string {
  return `${apiBase().replace(/^http/, 'ws')}/mm`;
}

export class Multiplayer {
  private ws: WebSocket | null = null;
  private finished = false;

  constructor(private readonly handlers: MpHandlers) {}

  /** Connect and enter the queue for a level. */
  queue(level: LevelId, identity: { gctx?: string | null; name?: string | null }): void {
    this.dispose();
    this.finished = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      this.handlers.onDrop?.();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.send({
        t: 'queue',
        level,
        gctx: identity.gctx ?? undefined,
        name: identity.name ?? undefined,
      });
    };
    ws.onmessage = (ev) => {
      let m: { t?: string } & Record<string, unknown>;
      try {
        m = JSON.parse(String(ev.data)) as typeof m;
      } catch {
        return;
      }
      if (m.t === 'queued') this.handlers.onQueued?.();
      else if (m.t === 'matched') this.handlers.onMatched?.(m as unknown as MpMatched);
      else if (m.t === 'opp') this.handlers.onOppRound?.(Number(m.n), m.correct === true);
      else if (m.t === 'sudden') this.handlers.onSudden?.(Number(m.round));
      else if (m.t === 'final') {
        this.finished = true;
        this.handlers.onFinal?.(m as unknown as MpFinal);
      }
    };
    ws.onclose = () => {
      if (!this.finished) this.handlers.onDrop?.();
    };
    ws.onerror = () => {
      /* onclose follows and reports the drop */
    };
  }

  sendRound(n: number, correct: boolean, ms: number): void {
    this.send({ t: 'round', n, correct, ms: Math.round(ms) });
  }

  /** Leave the queue (before a match starts). */
  leave(): void {
    this.send({ t: 'leave' });
    this.finished = true; // deliberate exit — don't report a drop
    this.dispose();
  }

  dispose(): void {
    if (this.ws) {
      const w = this.ws;
      this.ws = null;
      w.onclose = null;
      w.onerror = null;
      try {
        w.close();
      } catch {
        /* already closed */
      }
    }
  }

  private send(m: unknown): void {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    } catch {
      /* drop handled by onclose */
    }
  }
}

/** The signed launch context from the bot (present when opened via the Play button). */
export function launchGctx(): string | null {
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('tgctx');
}
