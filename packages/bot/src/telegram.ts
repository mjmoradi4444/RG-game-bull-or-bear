import type { Api } from 'grammy';
import type { GameContext } from './security';

/**
 * Thin wrappers over the two Games-platform Bot API calls. The bot — not the
 * browser — calls these, so the token stays server-side (SPEC §5.2).
 */

export async function submitGameScore(api: Api, ctx: GameContext, score: number): Promise<void> {
  try {
    if (ctx.i) {
      await api.setGameScoreInline(ctx.i, ctx.u, score, { disable_edit_message: true });
    } else if (ctx.c !== undefined && ctx.m !== undefined) {
      await api.setGameScore(ctx.c, ctx.m, ctx.u, score, { disable_edit_message: true });
    } else {
      throw new Error('insufficient context for setGameScore');
    }
  } catch (e) {
    // Telegram throws when the new score isn't a personal best — that's expected, not an error.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/not.?modified/i.test(msg)) throw e;
  }
}

export interface HighScore {
  rank: number;
  name: string;
  score: number;
  isSelf: boolean;
}

export async function fetchHighScores(api: Api, ctx: GameContext): Promise<HighScore[]> {
  const raw = ctx.i
    ? await api.getGameHighScoresInline(ctx.i, ctx.u)
    : ctx.c !== undefined && ctx.m !== undefined
      ? await api.getGameHighScores(ctx.c, ctx.m, ctx.u)
      : [];
  return raw.map((s) => ({
    rank: s.position,
    name: s.user.first_name || s.user.username || 'Player',
    score: s.score,
    isSelf: s.user.id === ctx.u,
  }));
}
