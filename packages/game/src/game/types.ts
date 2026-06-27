/** Shared gameplay types. */

export type GameState = 'title' | 'playing' | 'gameover';

/** The result of a single trade. Note: outcome never affects the rebate. */
export type Outcome = 'win' | 'loss';
