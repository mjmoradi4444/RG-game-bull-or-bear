import type { LevelId } from '../game/levels';

/**
 * Client for live 1-v-1 matchmaking over PLAIN HTTP POLLING (bot server, /mm/*).
 *
 * No WebSocket on purpose: the game must work behind reverse proxies the operator
 * may not control, and small same-origin JSON requests (the same transport as
 * /score) provably pass them. The client polls /mm/state every ~1.5s and diffs the
 * response into events: onMatched (seed + both profiles for the VS screen) →
 * sendRound() per round → onSudden (tie → extra round) → onFinal (winner).
 *
 * Pure networking — no Telegram imports, no engine imports. Identity: the signed
 * game context from the URL hash when launched from the bot (server resolves the
 * real Telegram name/avatar), else a display-name fallback.
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
  /** Transport gave up (repeated request failures) before a final was delivered. */
  onDrop?: () => void;
}

// Same base the score API uses: same origin in production (bot serves the game),
// VITE_SCORE_API when the API lives elsewhere (e.g. local dev).
const API_BASE = ((import.meta.env.VITE_SCORE_API as string | undefined) ?? '').replace(/\/$/, '');

export function apiBase(): string {
  return API_BASE || window.location.origin;
}

const POLL_MS = 1500;
/** Consecutive poll failures tolerated before reporting a drop (~4.5s of outage). */
const MAX_FAILURES = 3;

interface StateResponse {
  ok: boolean;
  state?: 'queued' | 'matched';
  matchId?: string;
  seed?: number;
  level?: LevelId;
  expect?: number;
  you?: MpProfile;
  opp?: MpProfile;
  oppRounds?: Array<{ n: number; correct: boolean }>;
  final?: MpFinal | null;
}

export class Multiplayer {
  private pid: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  private matched = false;
  private finished = false;
  private lastExpect = 0;
  private seenOppRounds = 0;

  constructor(private readonly handlers: MpHandlers) {}

  /** Join the queue for a level; polling starts once the server accepts. */
  queue(level: LevelId, identity: { gctx?: string | null; name?: string | null }): void {
    this.dispose();
    this.finished = false;
    this.matched = false;
    this.failures = 0;
    this.lastExpect = 0;
    this.seenOppRounds = 0;
    void fetch(`${apiBase()}/mm/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level,
        gctx: identity.gctx ?? undefined,
        name: identity.name ?? undefined,
      }),
    })
      .then(async (r) => {
        const d = (await r.json()) as { ok: boolean; pid?: string };
        if (!d.ok || !d.pid) throw new Error('queue rejected');
        this.pid = d.pid;
        this.handlers.onQueued?.();
        this.timer = setInterval(() => void this.poll(), POLL_MS);
        void this.poll(); // immediate first check (humans may match instantly)
      })
      .catch(() => {
        if (!this.finished) this.handlers.onDrop?.();
      });
  }

  private async poll(): Promise<void> {
    if (!this.pid || this.finished) return;
    let st: StateResponse;
    try {
      const r = await fetch(`${apiBase()}/mm/state?pid=${encodeURIComponent(this.pid)}`);
      st = (await r.json()) as StateResponse;
    } catch {
      if (++this.failures >= MAX_FAILURES && !this.finished) {
        this.stopPolling();
        this.handlers.onDrop?.();
      }
      return;
    }
    this.failures = 0;
    if (!st.ok) {
      // Server no longer knows us (restart / reaped) — treat as a drop.
      if (!this.finished) {
        this.stopPolling();
        this.handlers.onDrop?.();
      }
      return;
    }
    if (st.state !== 'matched') return;

    if (!this.matched && st.seed && st.you && st.opp && st.level) {
      this.matched = true;
      this.lastExpect = st.expect ?? 0;
      this.handlers.onMatched?.({
        matchId: st.matchId ?? '',
        seed: st.seed,
        level: st.level,
        you: st.you,
        opp: st.opp,
      });
    }
    const oppRounds = st.oppRounds ?? [];
    if (oppRounds.length > this.seenOppRounds) {
      for (const r of oppRounds.slice(this.seenOppRounds)) this.handlers.onOppRound?.(r.n, r.correct);
      this.seenOppRounds = oppRounds.length;
    }
    if ((st.expect ?? 0) > this.lastExpect && this.lastExpect > 0) {
      this.lastExpect = st.expect!;
      this.handlers.onSudden?.(st.expect!);
    }
    if (st.final && !this.finished) {
      this.finished = true;
      this.stopPolling();
      this.handlers.onFinal?.(st.final);
    }
  }

  sendRound(n: number, correct: boolean, ms: number): void {
    if (!this.pid) return;
    void fetch(`${apiBase()}/mm/round`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid: this.pid, n, correct, ms: Math.round(ms) }),
    }).catch(() => {
      /* next poll surfaces persistent outages */
    });
  }

  /** Leave the queue / abandon the match (deliberate exit — no drop event). */
  leave(): void {
    this.finished = true;
    this.stopPolling();
    if (this.pid) {
      void fetch(`${apiBase()}/mm/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid: this.pid }),
      }).catch(() => {});
      this.pid = null;
    }
  }

  dispose(): void {
    this.stopPolling();
    this.pid = null;
  }

  private stopPolling(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/** The signed launch context from the bot (present when opened via the Play button). */
export function launchGctx(): string | null {
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('tgctx');
}
